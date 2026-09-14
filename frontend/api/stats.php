<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

try {
    $pdo = db();
    $period = period_bounds((string) ($_GET['period'] ?? 'today'));
    $from = $period['from'];
    $to = $period['to'];
    $now = $period['now'];

    $openedParams = [];
    $openedWhere = date_where('opened_at', $from, $to, $openedParams, 'opened');

    $resolvedParams = [];
    $resolvedWhere = date_where('resolved_at', $from, $to, $resolvedParams, 'resolved');

    $errorSeveritySql = "severity IN ('critical','warning','other')";

    $summary = [];

    // Hovedtall: bare faktiske tekniske feil, IKKE toner/papir.
    $summary['opened_count'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE {$openedWhere} AND {$errorSeveritySql}",
        $openedParams
    );
    $summary['resolved_count'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NOT NULL AND {$resolvedWhere} AND {$errorSeveritySql}",
        $resolvedParams
    );

    foreach (['critical', 'warning', 'other'] as $severity) {
        $params = $openedParams;
        $params[':severity'] = $severity;
        $summary[$severity . '_count'] = (int) scalar_query(
            $pdo,
            "SELECT COUNT(*) FROM printer_incidents WHERE {$openedWhere} AND severity = :severity",
            $params
        );
    }

    $summary['affected_printers'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(DISTINCT printer_id) FROM printer_incidents WHERE {$openedWhere} AND {$errorSeveritySql}",
        $openedParams
    );

    $summary['avg_resolution_seconds'] = scalar_query(
        $pdo,
        "SELECT ROUND(AVG(TIMESTAMPDIFF(SECOND, opened_at, resolved_at)))
         FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere} AND {$errorSeveritySql}",
        $resolvedParams
    );
    $summary['avg_resolution_seconds'] = $summary['avg_resolution_seconds'] !== null
        ? (int) $summary['avg_resolution_seconds']
        : null;

    $summary['active_total'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NULL AND {$errorSeveritySql}"
    );
    $summary['active_critical'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NULL AND severity = 'critical'"
    );
    $summary['active_warning'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NULL AND severity = 'warning'"
    );
    $summary['active_other'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NULL AND severity = 'other'"
    );

    // Forbruksmateriell holdes utenfor feilstatistikken.
    $summary['toner_alerts_count'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE {$openedWhere} AND severity = 'toner'",
        $openedParams
    );
    $summary['toner_replaced_count'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
           AND severity = 'toner' AND resolution_type = 'replaced'",
        $resolvedParams
    );
    $summary['paper_empty_count'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE {$openedWhere} AND severity = 'paper'",
        $openedParams
    );
    $summary['paper_refilled_count'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
           AND severity = 'paper' AND resolution_type = 'refilled'",
        $resolvedParams
    );
    $summary['active_toner'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NULL AND severity = 'toner'"
    );
    $summary['active_paper'] = (int) scalar_query(
        $pdo,
        "SELECT COUNT(*) FROM printer_incidents WHERE resolved_at IS NULL AND severity = 'paper'"
    );

    // High-score for faktiske feil.
    $stmt = $pdo->prepare(
        "SELECT
            printer_id,
            MAX(printer_name) AS printer_name,
            MAX(printer_model) AS printer_model,
            COUNT(*) AS total,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning,
            SUM(CASE WHEN severity = 'other' THEN 1 ELSE 0 END) AS other
         FROM printer_incidents
         WHERE {$openedWhere} AND {$errorSeveritySql}
         GROUP BY printer_id
         ORDER BY total DESC, critical DESC, printer_name ASC
         LIMIT 10"
    );
    $stmt->execute($openedParams);
    $printerLeaderboard = $stmt->fetchAll();

    $stmt = $pdo->prepare(
        "SELECT
            fingerprint,
            MAX(error_message) AS error_message,
            MAX(error_code) AS error_code,
            MAX(severity) AS severity,
            COUNT(*) AS total,
            ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, opened_at, resolved_at) END)) AS avg_resolution_seconds
         FROM printer_incidents
         WHERE {$openedWhere} AND {$errorSeveritySql}
         GROUP BY fingerprint
         ORDER BY total DESC, error_message ASC
         LIMIT 10"
    );
    $stmt->execute($openedParams);
    $errorLeaderboard = $stmt->fetchAll();

    $stmt = $pdo->prepare(
        "SELECT
            id, printer_id, printer_name, printer_model, severity,
            error_message, error_code, opened_at, resolved_at,
            TIMESTAMPDIFF(SECOND, opened_at, resolved_at) AS duration_seconds
         FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere} AND {$errorSeveritySql}
         ORDER BY duration_seconds DESC
         LIMIT 1"
    );
    $stmt->execute($resolvedParams);
    $longestIncident = $stmt->fetch() ?: null;

    $stmt = $pdo->prepare(
        "SELECT
            id, printer_id, printer_name, printer_model, severity,
            error_message, error_code, opened_at,
            TIMESTAMPDIFF(SECOND, opened_at, :now) AS duration_seconds
         FROM printer_incidents
         WHERE resolved_at IS NULL AND {$errorSeveritySql}
         ORDER BY
            CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
            opened_at ASC
         LIMIT 50"
    );
    $stmt->execute([':now' => $now]);
    $activeIncidents = $stmt->fetchAll();

    // Tonerbytter per maskin i valgt periode.
    $stmt = $pdo->prepare(
        "SELECT
            printer_id,
            MAX(printer_name) AS printer_name,
            MAX(printer_model) AS printer_model,
            COUNT(*) AS total,
            SUM(CASE WHEN consumable_color = 'black' THEN 1 ELSE 0 END) AS black_count,
            SUM(CASE WHEN consumable_color = 'cyan' THEN 1 ELSE 0 END) AS cyan_count,
            SUM(CASE WHEN consumable_color = 'magenta' THEN 1 ELSE 0 END) AS magenta_count,
            SUM(CASE WHEN consumable_color = 'yellow' THEN 1 ELSE 0 END) AS yellow_count,
            SUM(CASE WHEN consumable_color = 'waste' THEN 1 ELSE 0 END) AS waste_count,
            SUM(CASE WHEN consumable_color IS NULL THEN 1 ELSE 0 END) AS unknown_count
         FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
           AND severity = 'toner' AND resolution_type = 'replaced'
         GROUP BY printer_id
         ORDER BY total DESC, printer_name ASC
         LIMIT 20"
    );
    $stmt->execute($resolvedParams);
    $tonerLeaderboard = $stmt->fetchAll();

    $stmt = $pdo->prepare(
        "SELECT
            COALESCE(consumable_color, 'unknown') AS color,
            COUNT(*) AS total
         FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
           AND severity = 'toner' AND resolution_type = 'replaced'
         GROUP BY COALESCE(consumable_color, 'unknown')
         ORDER BY total DESC, color ASC"
    );
    $stmt->execute($resolvedParams);
    $tonerByColor = $stmt->fetchAll();

    // Papirpåfyllinger per maskin.
    $stmt = $pdo->prepare(
        "SELECT
            printer_id,
            MAX(printer_name) AS printer_name,
            COUNT(*) AS total
         FROM printer_incidents
         WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
           AND severity = 'paper' AND resolution_type = 'refilled'
         GROUP BY printer_id
         ORDER BY total DESC, printer_name ASC
         LIMIT 20"
    );
    $stmt->execute($resolvedParams);
    $paperLeaderboard = $stmt->fetchAll();

    $stmt = $pdo->prepare(
        "SELECT
            pi.id, pi.printer_id, pi.printer_name, pi.printer_model, pi.severity,
            pi.error_message, pi.error_code, pi.opened_at,
            pi.consumable_color, pi.paper_tray,
            pi.toner_level_opened, pi.toner_level_last,
            ae.missing_since,
            TIMESTAMPDIFF(SECOND, pi.opened_at, :now) AS duration_seconds
         FROM printer_incidents pi
         INNER JOIN printer_active_errors ae ON ae.incident_id = pi.id
         WHERE pi.resolved_at IS NULL AND pi.severity IN ('toner','paper')
         ORDER BY pi.severity ASC, pi.opened_at ASC
         LIMIT 100"
    );
    $stmt->execute([':now' => $now]);
    $activeConsumables = $stmt->fetchAll();

    json_response([
        'ok' => true,
        'logger_version' => 3,
        'period' => [
            'key' => $period['key'],
            'label' => $period['label'],
            'from' => $from,
            'to' => $to,
        ],
        'summary' => $summary,
        'printer_leaderboard' => $printerLeaderboard,
        'error_leaderboard' => $errorLeaderboard,
        'longest_incident' => $longestIncident,
        'active_incidents' => $activeIncidents,
        'toner_leaderboard' => $tonerLeaderboard,
        'toner_by_color' => $tonerByColor,
        'paper_leaderboard' => $paperLeaderboard,
        'active_consumables' => $activeConsumables,
    ]);
} catch (Throwable $e) {
    error_log('stats.php: ' . $e->getMessage());
    fail_json('Kunne ikke hente statistikk.', 500);
}
