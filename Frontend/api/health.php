<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

/*
 * Installation check. Open /api/health.php in a browser after deploying.
 * Creates/upgrades the database tables on first call.
 */

$checks = [
    'php_version' => PHP_VERSION,
    'pdo_mysql' => extension_loaded('pdo_mysql'),
    'mbstring' => extension_loaded('mbstring'),
    'config_file' => is_file(__DIR__ . '/config.php'),
    'logger_key_configured' => strlen((string) (app_config()['logger_key'] ?? '')) >= 16,
    'timezone' => app_timezone()->getName(),
];

$dataFile = data_file_path();
$checks['printer_data'] = is_file($dataFile) ? 'present' : 'missing';
if (is_file($dataFile)) {
    $checks['printer_data_age_seconds'] = max(0, time() - (int) filemtime($dataFile));
}

try {
    $rules = load_error_rules();
    $checks['rules'] = array_values(array_intersect(['ignore', 'toner', 'paper', 'critical', 'warning'], array_keys($rules)));
} catch (Throwable $e) {
    $checks['rules'] = 'error: ' . $e->getMessage();
}

if (!history_configured()) {
    json_response([
        'ok' => true,
        'version' => APP_VERSION,
        'history' => false,
        'hint' => 'History/statistics are disabled until api/config.php (or DB_* environment variables) is configured.',
        'checks' => $checks,
    ]);
}

try {
    $pdo = db();
    $checks['database'] = 'connected';
    $checks['schema_version'] = (int) scalar_query($pdo, "SELECT v FROM app_meta WHERE k = 'schema_version'");
    $checks['incidents'] = (int) scalar_query($pdo, 'SELECT COUNT(*) FROM printer_incidents');
    $checks['active_errors'] = (int) scalar_query($pdo, 'SELECT COUNT(*) FROM printer_active_errors');

    json_response([
        'ok' => true,
        'version' => APP_VERSION,
        'logger_version' => LOGGER_VERSION,
        'history' => true,
        'server_time' => (new DateTimeImmutable('now', app_timezone()))->format(DateTimeInterface::ATOM),
        'checks' => $checks,
    ]);
} catch (Throwable $e) {
    error_log('health.php: ' . $e->getMessage());
    fail_json('Health check failed.', 500, [
        'version' => APP_VERSION,
        'hint' => 'Check the database settings in api/config.php, that PDO MySQL is enabled, and the PHP error log for details.',
        'checks' => $checks,
    ]);
}
