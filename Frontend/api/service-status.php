<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

/*
 * Public, read-only list of printers with an active incident that an admin
 * has marked as "reported to service". Used for the yellow SERVICE tape.
 */

try {
    if (!history_configured()) {
        // Static setup without a database: the website simply hides history features.
        json_response(['ok' => true, 'history' => false, 'printers' => []]);
    }

    $rows = db()->query(
        "SELECT id, printer_id, printer_name, printer_model, severity,
                error_message, error_code, opened_at, service_reported_at, service_note
         FROM printer_incidents
         WHERE resolved_at IS NULL AND service_status = 'reported'
         ORDER BY service_reported_at ASC, id ASC"
    )->fetchAll();

    $printers = [];
    foreach ($rows as $row) {
        $key = (string) $row['printer_id'];
        $printers[$key] ??= [
            'printer_id' => $key,
            'printer_name' => (string) $row['printer_name'],
            'printer_model' => (string) ($row['printer_model'] ?? ''),
            'service_reported_at' => $row['service_reported_at'],
            'service_note' => '',
            'incident_count' => 0,
            'incidents' => [],
        ];

        $note = trim((string) ($row['service_note'] ?? ''));
        if ($note !== '' && $printers[$key]['service_note'] === '') {
            $printers[$key]['service_note'] = $note;
        }

        $printers[$key]['incident_count']++;
        $printers[$key]['incidents'][] = [
            'severity' => (string) $row['severity'],
            'error_message' => (string) $row['error_message'],
            'error_code' => $row['error_code'],
            'opened_at' => $row['opened_at'],
        ];
    }

    json_response(['ok' => true, 'history' => true, 'printers' => array_values($printers)]);
} catch (Throwable $e) {
    error_log('service-status.php: ' . $e->getMessage());
    fail_json('Could not load service status.', 500);
}
