<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

/*
 * Statistics for the dashboard (?stats=1).
 * Technical faults (critical/warning/other) are counted separately from
 * consumables (toner/paper) so refills don't distort the fault numbers.
 */

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

    $technical = "severity IN ('critical','warning','other')";

    $opened = fetch_one($pdo, "
        SELECT
            SUM({$technical}) AS opened_count,
            SUM(severity = 'critical') AS critical_count,
            SUM(severity = 'warning') AS warning_count,
            SUM(severity = 'other') AS other_count,
            COUNT(DISTINCT CASE WHEN {$technical} THEN printer_id END) AS affected_printers,
            SUM(severity = 'toner') AS toner_alerts_count,
            SUM(severity = 'paper') AS paper_empty_count
        FROM printer_incidents
        WHERE {$openedWhere}", $openedParams) ?? [];

    $resolved = fetch_one($pdo, "
        SELECT
            SUM({$technical}) AS resolved_count,
            ROUND(AVG(CASE WHEN {$technical} THEN TIMESTAMPDIFF(SECOND, opened_at, resolved_at) END)) AS avg_resolution_seconds,
            SUM(severity = 'toner' AND resolution_type = 'replaced') AS toner_replaced_count,
            SUM(severity = 'paper' AND resolution_type = 'refilled') AS paper_refilled_count
        FROM printer_incidents
        WHERE resolved_at IS NOT NULL AND {$resolvedWhere}", $resolvedParams) ?? [];

    $active = fetch_one($pdo, "
        SELECT
            SUM({$technical}) AS active_total,
            SUM(severity = 'critical') AS active_critical,
            SUM(severity = 'warning') AS active_warning,
            SUM(severity = 'other') AS active_other,
            SUM(severity = 'toner') AS active_toner,
            SUM(severity = 'paper') AS active_paper,
            SUM({$technical} AND service_status = 'reported') AS active_service
        FROM printer_incidents
        WHERE resolved_at IS NULL") ?? [];

    $summary = [];
    foreach (array_merge($opened, $resolved, $active) as $key => $value) {
        $summary[$key] = $value === null ? ($key === 'avg_resolution_seconds' ? null : 0) : (int) $value;
    }

    $printerLeaderboard = fetch_all($pdo, "
        SELECT
            printer_id,
            MAX(printer_name) AS printer_name,
            MAX(printer_model) AS printer_model,
            COUNT(*) AS total,
            SUM(severity = 'critical') AS critical,
            SUM(severity = 'warning') AS warning,
            SUM(severity = 'other') AS other
        FROM printer_incidents
        WHERE {$openedWhere} AND {$technical}
        GROUP BY printer_id
        ORDER BY total DESC, critical DESC, printer_name ASC
        LIMIT 10", $openedParams);

    $errorLeaderboard = fetch_all($pdo, "
        SELECT
            fingerprint,
            MAX(error_message) AS error_message,
            MAX(error_code) AS error_code,
            MAX(severity) AS severity,
            COUNT(*) AS total,
            ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, opened_at, resolved_at) END)) AS avg_resolution_seconds
        FROM printer_incidents
        WHERE {$openedWhere} AND {$technical}
        GROUP BY fingerprint
        ORDER BY total DESC, error_message ASC
        LIMIT 10", $openedParams);

    $longestIncident = fetch_one($pdo, "
        SELECT
            id, printer_id, printer_name, printer_model, severity,
            error_message, error_code, opened_at, resolved_at,
            service_status, service_reported_at, service_note,
            TIMESTAMPDIFF(SECOND, opened_at, resolved_at) AS duration_seconds
        FROM printer_incidents
        WHERE resolved_at IS NOT NULL AND {$resolvedWhere} AND {$technical}
        ORDER BY duration_seconds DESC
        LIMIT 1", $resolvedParams);

    $activeIncidents = fetch_all($pdo, "
        SELECT
            id, printer_id, printer_name, printer_model, severity,
            error_message, error_code, opened_at,
            service_status, service_reported_at, service_note,
            TIMESTAMPDIFF(SECOND, opened_at, :now) AS duration_seconds
        FROM printer_incidents
        WHERE resolved_at IS NULL AND {$technical}
        ORDER BY FIELD(severity, 'critical', 'warning', 'other'), opened_at ASC
        LIMIT 50", [':now' => $now]);

    $tonerLeaderboard = fetch_all($pdo, "
        SELECT
            printer_id,
            MAX(printer_name) AS printer_name,
            MAX(printer_model) AS printer_model,
            COUNT(*) AS total,
            SUM(consumable_color = 'black') AS black_count,
            SUM(consumable_color = 'cyan') AS cyan_count,
            SUM(consumable_color = 'magenta') AS magenta_count,
            SUM(consumable_color = 'yellow') AS yellow_count,
            SUM(consumable_color = 'waste') AS waste_count,
            SUM(consumable_color IS NULL) AS unknown_count
        FROM printer_incidents
        WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
          AND severity = 'toner' AND resolution_type = 'replaced'
        GROUP BY printer_id
        ORDER BY total DESC, printer_name ASC
        LIMIT 20", $resolvedParams);

    $paperLeaderboard = fetch_all($pdo, "
        SELECT printer_id, MAX(printer_name) AS printer_name, COUNT(*) AS total
        FROM printer_incidents
        WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
          AND severity = 'paper' AND resolution_type = 'refilled'
        GROUP BY printer_id
        ORDER BY total DESC, printer_name ASC
        LIMIT 20", $resolvedParams);

    $activeConsumables = fetch_all($pdo, "
        SELECT
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
        LIMIT 100", [':now' => $now]);

    json_response([
        'ok' => true,
        'logger_version' => LOGGER_VERSION,
        'period' => ['key' => $period['key'], 'from' => $from, 'to' => $to],
        'summary' => $summary,
        'printer_leaderboard' => $printerLeaderboard,
        'error_leaderboard' => $errorLeaderboard,
        'longest_incident' => $longestIncident,
        'active_incidents' => $activeIncidents,
        'toner_leaderboard' => $tonerLeaderboard,
        'paper_leaderboard' => $paperLeaderboard,
        'active_consumables' => $activeConsumables,
    ]);
} catch (Throwable $e) {
    error_log('stats.php: ' . $e->getMessage());
    fail_json('Could not load statistics.', 500);
}
