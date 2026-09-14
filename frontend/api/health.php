<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

try {
    require __DIR__ . '/bootstrap.php';

    $incidentCount = 0;
    $activeErrorCount = 0;

    // Test database connection
    $pdo->query('SELECT 1');

    // Count logged incidents
    try {
        $stmt = $pdo->query(
            'SELECT COUNT(*) FROM printer_incidents'
        );

        $incidentCount = (int) $stmt->fetchColumn();

    } catch (Throwable $e) {
        // Health endpoint should still work even if
        // statistics cannot be retrieved.
        $incidentCount = 0;
    }

    // Count currently active incidents
    try {
        $stmt = $pdo->query(
            'SELECT COUNT(*) FROM printer_active_errors'
        );

        $activeErrorCount = (int) $stmt->fetchColumn();

    } catch (Throwable $e) {
        $activeErrorCount = 0;
    }

    echo json_encode(
        [
            'ok' => true,
            'logger_version' => 3,
            'database' => 'connected',
            'rules' => is_file(
                dirname(__DIR__) . '/error_rules.json'
            )
                ? 'available'
                : 'missing',
            'incidents' => $incidentCount,
            'active_errors' => $activeErrorCount,
            'server_time' => date(DATE_ATOM),
            'timezone' => date_default_timezone_get(),
        ],
        JSON_PRETTY_PRINT
        | JSON_UNESCAPED_SLASHES
        | JSON_UNESCAPED_UNICODE
    );

} catch (Throwable $e) {
    http_response_code(500);

    echo json_encode(
        [
            'ok' => false,
            'logger_version' => 3,
            'database' => 'error',
            'error' => 'Health check failed',
            'server_time' => date(DATE_ATOM),
        ],
        JSON_PRETTY_PRINT
        | JSON_UNESCAPED_SLASHES
        | JSON_UNESCAPED_UNICODE
    );
}
