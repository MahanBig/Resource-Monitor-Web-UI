<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

try {
    require __DIR__ . '/bootstrap.php';
    $pdo = db();

    $incidentCount = 0;
    $activeErrorCount = 0;

    // Test databaseforbindelse
    $pdo->query('SELECT 1');

    // Tell hendelser
    try {
        $stmt = $pdo->query('SELECT COUNT(*) FROM printer_incidents');
        $incidentCount = (int) $stmt->fetchColumn();
    } catch (Throwable) {
        $incidentCount = 0;
    }

    // Tell aktive feil
    try {
        $stmt = $pdo->query('SELECT COUNT(*) FROM printer_active_errors');
        $activeErrorCount = (int) $stmt->fetchColumn();
    } catch (Throwable) {
        $activeErrorCount = 0;
    }

    echo json_encode(
        [
            'ok' => true,
            'service' => 'Ricoh Web API',
            'version' => '3.1.0',
            'database' => 'connected',
            'rules' => is_file(dirname(__DIR__) . '/error_rules.json') ? 'available' : 'missing',
            'incidents_logged' => $incidentCount,
            'active_errors' => $activeErrorCount,
            'server_time' => date(DATE_ATOM),
            'timezone' => date_default_timezone_get(),
        ],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(
        [
            'ok' => false,
            'service' => 'Ricoh Web API',
            'version' => '3.1.0',
            'database' => 'error',
            'error' => $e->getMessage(),
            'server_time' => date(DATE_ATOM),
        ],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
}
