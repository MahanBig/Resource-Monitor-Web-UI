<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail_json('Bruk POST.', 405);
}

require_logger_auth();

try {
    $rawBody = trim((string) file_get_contents('php://input'));

    if ($rawBody !== '') {
        $printerData = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
    } else {
        $printerFile = dirname(__DIR__) . '/printer_data.json';
        if (!is_file($printerFile)) {
            fail_json('Ingen JSON-body og printer_data.json finnes ikke.', 400);
        }
        $printerData = json_decode((string) file_get_contents($printerFile), true, 512, JSON_THROW_ON_ERROR);
    }

    if (!is_array($printerData)) {
        fail_json('Forventet en JSON-array med printere.', 400);
    }

    $pdo = db();
    $rules = load_error_rules();
    $settings = logger_settings();

    $lockName = 'kopimaskin_event_logger_v3';
    $lockStmt = $pdo->prepare('SELECT GET_LOCK(:lock_name, 5)');
    $lockStmt->execute([':lock_name' => $lockName]);
    if ((int) $lockStmt->fetchColumn() !== 1) {
        fail_json('Loggeren er opptatt. Snapshotet kan prøves igjen ved neste polling.', 409);
    }

    $opened = 0;
    $resolved = 0;
    $ignored = 0;
    $seen = 0;
    $duplicates = 0;
    $printersProcessed = 0;
    $resolutionSuppressed = 0;
    $tonerOpened = 0;
    $tonerReplaced = 0;
    $paperOpened = 0;
    $paperRefilled = 0;
    $tonerWaitingForConfirmation = 0;

    try {
        $pdo->beginTransaction();

        $selectActive = $pdo->prepare(
            'SELECT
                ae.printer_id,
                ae.fingerprint,
                ae.incident_id,
                ae.last_seen_at,
                ae.missing_since,
                pi.severity,
                pi.consumable_color,
                pi.paper_tray,
                pi.toner_level_opened,
                pi.toner_level_last
             FROM printer_active_errors ae
             INNER JOIN printer_incidents pi ON pi.id = ae.incident_id
             WHERE ae.printer_id = :printer_id'
        );

        $insertIncident = $pdo->prepare(
            'INSERT INTO printer_incidents
                (printer_id, printer_name, printer_ip, printer_model, severity,
                 error_code, error_message, fingerprint, opened_at,
                 consumable_color, paper_tray, toner_level_opened, toner_level_last)
             VALUES
                (:printer_id, :printer_name, :printer_ip, :printer_model, :severity,
                 :error_code, :error_message, :fingerprint, :opened_at,
                 :consumable_color, :paper_tray, :toner_level_opened, :toner_level_last)'
        );

        $insertActive = $pdo->prepare(
            'INSERT INTO printer_active_errors
                (printer_id, fingerprint, incident_id, last_seen_at, missing_since)
             VALUES
                (:printer_id, :fingerprint, :incident_id, :last_seen_at, NULL)'
        );

        $touchActive = $pdo->prepare(
            'UPDATE printer_active_errors
             SET last_seen_at = :last_seen_at,
                 missing_since = NULL
             WHERE printer_id = :printer_id AND fingerprint = :fingerprint'
        );

        $markMissing = $pdo->prepare(
            'UPDATE printer_active_errors
             SET missing_since = COALESCE(missing_since, :missing_since)
             WHERE printer_id = :printer_id AND fingerprint = :fingerprint'
        );

        $updateIncident = $pdo->prepare(
            'UPDATE printer_incidents
             SET printer_name = :printer_name,
                 printer_ip = :printer_ip,
                 printer_model = :printer_model,
                 severity = :severity,
                 error_code = :error_code,
                 error_message = :error_message,
                 consumable_color = COALESCE(:consumable_color, consumable_color),
                 paper_tray = COALESCE(:paper_tray, paper_tray),
                 toner_level_last = COALESCE(:toner_level_last, toner_level_last)
             WHERE id = :incident_id AND resolved_at IS NULL'
        );

        $resolveIncident = $pdo->prepare(
            'UPDATE printer_incidents
             SET resolved_at = :resolved_at,
                 resolution_type = :resolution_type,
                 toner_level_resolved = :toner_level_resolved,
                 replacement_confirmed_by_level = :replacement_confirmed_by_level
             WHERE id = :incident_id AND resolved_at IS NULL'
        );

        $deleteActive = $pdo->prepare(
            'DELETE FROM printer_active_errors
             WHERE printer_id = :printer_id AND fingerprint = :fingerprint'
        );

        foreach ($printerData as $printer) {
            if (!is_array($printer)) {
                continue;
            }

            $printersProcessed++;
            $printerId = printer_identifier($printer);
            $printerName = trim((string) ($printer['Name'] ?? 'Ukjent printer'));
            $printerIp = trim((string) ($printer['IP'] ?? ''));
            $printerModel = trim((string) ($printer['Model'] ?? ''));
            $snapshotAt = snapshot_time($printer);

            $selectActive->execute([':printer_id' => $printerId]);
            $activeRows = $selectActive->fetchAll();
            $activeByFingerprint = [];
            $activeTonerByColor = [];

            foreach ($activeRows as $row) {
                $activeByFingerprint[(string) $row['fingerprint']] = $row;
                if (($row['severity'] ?? '') === 'toner' && !empty($row['consumable_color'])) {
                    $activeTonerByColor[(string) $row['consumable_color']] = $row;
                }
            }

            $errorsFieldValid = array_key_exists('Errors', $printer) && is_array($printer['Errors']);
            $resolutionTrusted = $errorsFieldValid;
            $errors = $errorsFieldValid ? $printer['Errors'] : [];

            // Fingerprints som faktisk er observert i dette snapshotet.
            // For gamle tonerhendelser kan fingerprint være fra v2; da bruker vi den eksisterende aktive fingerprinten.
            $currentFingerprints = [];
            $dedupeKeys = [];

            foreach ($errors as $rawError) {
                if (!is_string($rawError) || trim($rawError) === '') {
                    continue;
                }

                $seen++;
                $parsed = parse_error_string($rawError);

                if (($parsed['normalized_message'] ?? '') === 'error fetching errors') {
                    $resolutionTrusted = false;
                }

                $severity = classify_error($parsed, $rules);
                if ($severity === null) {
                    $ignored++;
                    continue;
                }

                $tonerColor = $severity === 'toner' ? detect_toner_color($parsed) : null;
                $paperTray = $severity === 'paper' ? detect_paper_tray($parsed) : null;
                $tonerLevel = $severity === 'toner' ? toner_level_for_color($printer, $tonerColor) : null;

                $calculatedFingerprint = incident_fingerprint($parsed, $severity, $tonerColor);
                $dedupeKey = $severity === 'toner' && $tonerColor !== null
                    ? 'toner:' . $tonerColor
                    : $calculatedFingerprint;

                if (isset($dedupeKeys[$dedupeKey])) {
                    $duplicates++;
                    continue;
                }
                $dedupeKeys[$dedupeKey] = true;

                $activeRow = $activeByFingerprint[$calculatedFingerprint] ?? null;

                // Migrerte v2-hendelser kan ha gammel fingerprint. Match toner på farge for å unngå duplikat.
                if ($activeRow === null && $severity === 'toner' && $tonerColor !== null) {
                    $activeRow = $activeTonerByColor[$tonerColor] ?? null;
                }

                if ($activeRow !== null) {
                    $activeFingerprint = (string) $activeRow['fingerprint'];
                    $currentFingerprints[$activeFingerprint] = true;
                    $incidentId = (int) $activeRow['incident_id'];

                    $touchActive->execute([
                        ':last_seen_at' => $snapshotAt,
                        ':printer_id' => $printerId,
                        ':fingerprint' => $activeFingerprint,
                    ]);

                    $updateIncident->execute([
                        ':printer_name' => $printerName,
                        ':printer_ip' => $printerIp,
                        ':printer_model' => $printerModel,
                        ':severity' => $severity,
                        ':error_code' => $parsed['code'] !== '' ? $parsed['code'] : null,
                        ':error_message' => $parsed['message'],
                        ':consumable_color' => $tonerColor,
                        ':paper_tray' => $paperTray,
                        ':toner_level_last' => $tonerLevel,
                        ':incident_id' => $incidentId,
                    ]);
                    continue;
                }

                $fingerprint = $calculatedFingerprint;
                $currentFingerprints[$fingerprint] = true;

                $insertIncident->execute([
                    ':printer_id' => $printerId,
                    ':printer_name' => $printerName,
                    ':printer_ip' => $printerIp,
                    ':printer_model' => $printerModel,
                    ':severity' => $severity,
                    ':error_code' => $parsed['code'] !== '' ? $parsed['code'] : null,
                    ':error_message' => $parsed['message'],
                    ':fingerprint' => $fingerprint,
                    ':opened_at' => $snapshotAt,
                    ':consumable_color' => $tonerColor,
                    ':paper_tray' => $paperTray,
                    ':toner_level_opened' => $tonerLevel,
                    ':toner_level_last' => $tonerLevel,
                ]);

                $incidentId = (int) $pdo->lastInsertId();
                $insertActive->execute([
                    ':printer_id' => $printerId,
                    ':fingerprint' => $fingerprint,
                    ':incident_id' => $incidentId,
                    ':last_seen_at' => $snapshotAt,
                ]);

                $newRow = [
                    'printer_id' => $printerId,
                    'fingerprint' => $fingerprint,
                    'incident_id' => $incidentId,
                    'missing_since' => null,
                    'severity' => $severity,
                    'consumable_color' => $tonerColor,
                    'paper_tray' => $paperTray,
                    'toner_level_opened' => $tonerLevel,
                    'toner_level_last' => $tonerLevel,
                ];
                $activeByFingerprint[$fingerprint] = $newRow;
                if ($severity === 'toner' && $tonerColor !== null) {
                    $activeTonerByColor[$tonerColor] = $newRow;
                }

                $opened++;
                if ($severity === 'toner') {
                    $tonerOpened++;
                } elseif ($severity === 'paper') {
                    $paperOpened++;
                }
            }

            if (!$resolutionTrusted) {
                $resolutionSuppressed++;
                continue;
            }

            foreach ($activeRows as $activeRow) {
                $fingerprint = (string) $activeRow['fingerprint'];
                if (isset($currentFingerprints[$fingerprint])) {
                    continue;
                }

                $severity = (string) ($activeRow['severity'] ?? 'other');
                $resolutionType = 'resolved';
                $tonerLevelResolved = null;
                $confirmedByLevel = 0;

                if ($severity === 'toner') {
                    $missingSince = $activeRow['missing_since'] ?? null;

                    if ($missingSince === null || $missingSince === '') {
                        $markMissing->execute([
                            ':missing_since' => $snapshotAt,
                            ':printer_id' => $printerId,
                            ':fingerprint' => $fingerprint,
                        ]);
                        $tonerWaitingForConfirmation++;
                        continue;
                    }

                    $color = $activeRow['consumable_color'] ?: null;
                    $currentLevel = toner_level_for_color($printer, $color);
                    $openedLevel = $activeRow['toner_level_opened'] !== null
                        ? (int) $activeRow['toner_level_opened']
                        : null;
                    $lastLevel = $activeRow['toner_level_last'] !== null
                        ? (int) $activeRow['toner_level_last']
                        : null;

                    $levelConfirmed = false;
                    if ($currentLevel !== null) {
                        if ($currentLevel >= $settings['toner_full_threshold']) {
                            $levelConfirmed = true;
                        }
                        if ($openedLevel !== null && ($currentLevel - $openedLevel) >= $settings['toner_level_jump_threshold']) {
                            $levelConfirmed = true;
                        }
                        if ($lastLevel !== null && ($currentLevel - $lastLevel) >= $settings['toner_level_jump_threshold']) {
                            $levelConfirmed = true;
                        }
                    }

                    $requiredSeconds = $levelConfirmed
                        ? $settings['toner_confirm_seconds']
                        : $settings['toner_confirm_without_level_seconds'];

                    if (seconds_between((string) $missingSince, $snapshotAt) < $requiredSeconds) {
                        $tonerWaitingForConfirmation++;
                        continue;
                    }

                    $resolutionType = 'replaced';
                    $tonerLevelResolved = $currentLevel;
                    $confirmedByLevel = $levelConfirmed ? 1 : 0;
                } elseif ($severity === 'paper') {
                    $resolutionType = 'refilled';
                }

                $resolveIncident->execute([
                    ':resolved_at' => $snapshotAt,
                    ':resolution_type' => $resolutionType,
                    ':toner_level_resolved' => $tonerLevelResolved,
                    ':replacement_confirmed_by_level' => $confirmedByLevel,
                    ':incident_id' => (int) $activeRow['incident_id'],
                ]);

                $deleteActive->execute([
                    ':printer_id' => $printerId,
                    ':fingerprint' => $fingerprint,
                ]);

                $resolved++;
                if ($severity === 'toner') {
                    $tonerReplaced++;
                } elseif ($severity === 'paper') {
                    $paperRefilled++;
                }
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(:lock_name)');
        $release->execute([':lock_name' => $lockName]);
    }

    json_response([
        'ok' => true,
        'logger_version' => 3,
        'printers_processed' => $printersProcessed,
        'raw_error_entries_seen' => $seen,
        'ignored_status_entries' => $ignored,
        'duplicate_entries_ignored' => $duplicates,
        'incidents_opened' => $opened,
        'incidents_resolved' => $resolved,
        'toner_alerts_opened' => $tonerOpened,
        'toner_replacements_confirmed' => $tonerReplaced,
        'toner_waiting_for_confirmation' => $tonerWaitingForConfirmation,
        'paper_empty_opened' => $paperOpened,
        'paper_refills_confirmed' => $paperRefilled,
        'resolution_suppressed_for_untrusted_printers' => $resolutionSuppressed,
        'processed_at' => (new DateTimeImmutable())->format(DateTimeInterface::ATOM),
    ]);
} catch (JsonException $e) {
    fail_json('Ugyldig JSON: ' . $e->getMessage(), 400);
} catch (Throwable $e) {
    error_log('process-printers.php: ' . $e->getMessage());
    fail_json('Intern feil i loggeren.', 500);
}
