<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

/*
 * Event log: incidents opened, resolved and reported to service within a period.
 */

try {
    $pdo = db();
    $period = period_bounds((string) ($_GET['period'] ?? 'today'));
    $limit = max(1, min(500, (int) ($_GET['limit'] ?? 150)));
    $from = $period['from'];
    $to = $period['to'];

    $columns = "id, printer_id, printer_name, printer_model, severity,
        error_message, error_code, opened_at, resolved_at,
        service_status, service_reported_at, service_note,
        consumable_color, paper_tray,
        toner_level_opened, toner_level_last, toner_level_resolved,
        resolution_type, replacement_confirmed_by_level";

    $queries = [
        'opened' => ['opened_at', 'TRUE', 'CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, opened_at, resolved_at) END'],
        'resolved' => ['resolved_at', 'resolved_at IS NOT NULL', 'TIMESTAMPDIFF(SECOND, opened_at, resolved_at)'],
        'service_reported' => ['service_reported_at', "service_status = 'reported' AND service_reported_at IS NOT NULL", 'TIMESTAMPDIFF(SECOND, opened_at, service_reported_at)'],
    ];

    $events = [];
    foreach ($queries as $type => [$column, $condition, $duration]) {
        $params = [];
        $where = date_where($column, $from, $to, $params, $type);
        $events = array_merge($events, fetch_all($pdo, "
            SELECT '{$type}' AS event_type, {$column} AS event_at, {$columns}, {$duration} AS duration_seconds
            FROM printer_incidents
            WHERE {$condition} AND {$where}
            ORDER BY {$column} DESC
            LIMIT {$limit}", $params));
    }

    usort($events, static fn (array $a, array $b): int => strcmp((string) $b['event_at'], (string) $a['event_at']));

    json_response([
        'ok' => true,
        'logger_version' => LOGGER_VERSION,
        'period' => ['key' => $period['key'], 'from' => $from, 'to' => $to],
        'events' => array_slice($events, 0, $limit),
    ]);
} catch (Throwable $e) {
    error_log('events.php: ' . $e->getMessage());
    fail_json('Could not load the event log.', 500);
}
