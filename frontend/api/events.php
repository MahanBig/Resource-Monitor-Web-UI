<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

try {
    $pdo = db();
    $period = period_bounds((string) ($_GET['period'] ?? 'today'));
    $limit = max(1, min(500, (int) ($_GET['limit'] ?? 150)));

    $from = $period['from'];
    $to = $period['to'];

    $openedParams = [];
    $openedWhere = date_where('opened_at', $from, $to, $openedParams, 'opened');
    $openedSql = "SELECT
            id, 'opened' AS event_type, opened_at AS event_at,
            printer_id, printer_name, printer_model, severity,
            error_message, error_code, opened_at, resolved_at,
            consumable_color, paper_tray,
            toner_level_opened, toner_level_last, toner_level_resolved,
            resolution_type, replacement_confirmed_by_level,
            CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, opened_at, resolved_at) ELSE NULL END AS duration_seconds
        FROM printer_incidents
        WHERE {$openedWhere}
        ORDER BY opened_at DESC
        LIMIT {$limit}";
    $stmt = $pdo->prepare($openedSql);
    $stmt->execute($openedParams);
    $events = $stmt->fetchAll();

    $resolvedParams = [];
    $resolvedWhere = date_where('resolved_at', $from, $to, $resolvedParams, 'resolved');
    $resolvedSql = "SELECT
            id, 'resolved' AS event_type, resolved_at AS event_at,
            printer_id, printer_name, printer_model, severity,
            error_message, error_code, opened_at, resolved_at,
            consumable_color, paper_tray,
            toner_level_opened, toner_level_last, toner_level_resolved,
            resolution_type, replacement_confirmed_by_level,
            TIMESTAMPDIFF(SECOND, opened_at, resolved_at) AS duration_seconds
        FROM printer_incidents
        WHERE resolved_at IS NOT NULL AND {$resolvedWhere}
        ORDER BY resolved_at DESC
        LIMIT {$limit}";
    $stmt = $pdo->prepare($resolvedSql);
    $stmt->execute($resolvedParams);
    $events = array_merge($events, $stmt->fetchAll());

    usort($events, static function (array $a, array $b): int {
        return strcmp((string) $b['event_at'], (string) $a['event_at']);
    });
    $events = array_slice($events, 0, $limit);

    json_response([
        'ok' => true,
        'logger_version' => 3,
        'period' => [
            'key' => $period['key'],
            'label' => $period['label'],
            'from' => $from,
            'to' => $to,
        ],
        'events' => $events,
    ]);
} catch (Throwable $e) {
    error_log('events.php: ' . $e->getMessage());
    fail_json('Kunne ikke hente hendelsesloggen.', 500);
}
