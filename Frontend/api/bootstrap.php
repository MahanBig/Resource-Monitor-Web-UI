<?php
declare(strict_types=1);

/*
 * Shared helpers for the history API and the admin page.
 *
 * Configuration comes from api/config.php (copy config.example.php) and/or
 * environment variables (DB_HOST, DB_NAME, DB_USER, DB_PASS, LOGGER_KEY,
 * APP_TIMEZONE, DATA_FILE). Environment variables win, which makes Docker
 * deployments work without any config file.
 */

const APP_VERSION = '4.0.0';
const LOGGER_VERSION = 4;
const SCHEMA_VERSION = 1;

function app_config(): array
{
    static $config = null;
    if (is_array($config)) {
        return $config;
    }

    $config = [];
    $path = __DIR__ . '/config.php';
    if (is_file($path)) {
        $loaded = require $path;
        if (!is_array($loaded)) {
            throw new RuntimeException('api/config.php must return an array.');
        }
        $config = $loaded;
    }

    $env = static function (string $name): ?string {
        $value = getenv($name);
        return ($value === false || $value === '') ? null : $value;
    };

    $map = [
        'DB_HOST' => ['db', 'host'],
        'DB_PORT' => ['db', 'port'],
        'DB_NAME' => ['db', 'name'],
        'DB_USER' => ['db', 'user'],
        'DB_PASS' => ['db', 'pass'],
        'LOGGER_KEY' => ['logger_key'],
        'APP_TIMEZONE' => ['timezone'],
        'DATA_FILE' => ['data_file'],
    ];
    foreach ($map as $name => $keys) {
        $value = $env($name);
        if ($value === null) {
            continue;
        }
        if (count($keys) === 2) {
            $config[$keys[0]][$keys[1]] = $value;
        } else {
            $config[$keys[0]] = $value;
        }
    }

    return $config;
}

function app_timezone(): DateTimeZone
{
    static $tz = null;
    if ($tz === null) {
        $name = (string) (app_config()['timezone'] ?? '') ?: (getenv('TZ') ?: 'Europe/Oslo');
        try {
            $tz = new DateTimeZone($name);
        } catch (Throwable) {
            $tz = new DateTimeZone('UTC');
        }
    }
    return $tz;
}

date_default_timezone_set(app_timezone()->getName());

function data_file_path(): string
{
    $configured = (string) (app_config()['data_file'] ?? '');
    return $configured !== '' ? $configured : dirname(__DIR__) . '/printer_data.json';
}

function logger_settings(): array
{
    $custom = app_config()['logger'] ?? [];

    return [
        // A toner warning that disappeared AND whose level jumped must stay gone this long.
        'toner_confirm_seconds' => (int) ($custom['toner_confirm_seconds'] ?? 600),
        // A toner warning that disappeared without a clear level jump must stay gone longer.
        'toner_confirm_without_level_seconds' => (int) ($custom['toner_confirm_without_level_seconds'] ?? 1800),
        'toner_full_threshold' => (int) ($custom['toner_full_threshold'] ?? 70),
        'toner_level_jump_threshold' => (int) ($custom['toner_level_jump_threshold'] ?? 30),
    ];
}

/* ------------------------------------------------------------------------
 * Database
 * --------------------------------------------------------------------- */

function history_configured(): bool
{
    $db = app_config()['db'] ?? [];
    return !empty($db['host']) && !empty($db['name']) && !empty($db['user']);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    if (!history_configured()) {
        throw new RuntimeException('Database is not configured. Create api/config.php or set DB_HOST/DB_NAME/DB_USER/DB_PASS.');
    }

    $db = app_config()['db'];
    $dsn = sprintf(
        'mysql:host=%s;%sdbname=%s;charset=%s',
        $db['host'],
        !empty($db['port']) ? 'port=' . (int) $db['port'] . ';' : '',
        $db['name'],
        $db['charset'] ?? 'utf8mb4'
    );

    $pdo = new PDO($dsn, (string) $db['user'], (string) ($db['pass'] ?? ''), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    // Keep MariaDB DATETIME arithmetic in the same zone as PHP.
    $offset = (new DateTimeImmutable('now', app_timezone()))->format('P');
    $pdo->exec("SET time_zone = '{$offset}'");

    ensure_schema($pdo);
    return $pdo;
}

function column_exists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c'
    );
    $stmt->execute([':t' => $table, ':c' => $column]);
    return (int) $stmt->fetchColumn() > 0;
}

/**
 * Creates or upgrades the tables automatically, so a fresh install only needs
 * an empty database. Older installs (logger v2/v3 without service columns)
 * are upgraded in place without losing history.
 */
function ensure_schema(PDO $pdo): void
{
    try {
        $version = (int) $pdo->query("SELECT v FROM app_meta WHERE k = 'schema_version'")->fetchColumn();
        if ($version >= SCHEMA_VERSION) {
            return;
        }
    } catch (PDOException) {
        // app_meta does not exist yet: fall through and migrate.
    }

    try {
        $schema = (string) @file_get_contents(__DIR__ . '/schema.sql');
        if ($schema === '') {
            throw new RuntimeException('api/schema.sql is missing.');
        }
        // Strip comments and run the CREATE TABLE IF NOT EXISTS statements one by one.
        $schema = (string) preg_replace('/^\s*--.*$/m', '', $schema);
        foreach (array_filter(array_map('trim', explode(';', $schema))) as $statement) {
            $pdo->exec($statement);
        }

        $columns = [
            'consumable_color' => 'VARCHAR(16) NULL',
            'paper_tray' => 'VARCHAR(32) NULL',
            'toner_level_opened' => 'TINYINT UNSIGNED NULL',
            'toner_level_last' => 'TINYINT UNSIGNED NULL',
            'toner_level_resolved' => 'TINYINT UNSIGNED NULL',
            'resolution_type' => "ENUM('resolved','replaced','refilled') NULL",
            'replacement_confirmed_by_level' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'service_status' => "ENUM('none','reported') NOT NULL DEFAULT 'none'",
            'service_reported_at' => 'DATETIME NULL',
            'service_note' => 'VARCHAR(500) NULL',
            'service_reported_by' => 'VARCHAR(100) NULL',
        ];
        foreach ($columns as $name => $definition) {
            if (!column_exists($pdo, 'printer_incidents', $name)) {
                $pdo->exec("ALTER TABLE printer_incidents ADD COLUMN {$name} {$definition}");
            }
        }
        $pdo->exec(
            "ALTER TABLE printer_incidents MODIFY severity
             ENUM('critical','warning','toner','paper','other') NOT NULL"
        );
        if (!column_exists($pdo, 'printer_active_errors', 'missing_since')) {
            $pdo->exec('ALTER TABLE printer_active_errors ADD COLUMN missing_since DATETIME NULL');
        }

        $stmt = $pdo->prepare(
            "INSERT INTO app_meta (k, v) VALUES ('schema_version', :v)
             ON DUPLICATE KEY UPDATE v = VALUES(v)"
        );
        $stmt->execute([':v' => (string) SCHEMA_VERSION]);
    } catch (PDOException | RuntimeException $e) {
        throw new RuntimeException(
            'Could not create/upgrade the database tables automatically (' . $e->getMessage()
            . '). Run sql/schema.sql manually in phpMyAdmin.',
            0,
            $e
        );
    }
}

/* ------------------------------------------------------------------------
 * HTTP helpers
 * --------------------------------------------------------------------- */

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail_json(string $message, int $status = 500, array $extra = []): never
{
    json_response(array_merge(['ok' => false, 'error' => $message], $extra), $status);
}

function get_request_header(string $name): ?string
{
    $serverName = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$serverName])) {
        return trim((string) $_SERVER[$serverName]);
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $headerName => $value) {
            if (strcasecmp((string) $headerName, $name) === 0) {
                return trim((string) $value);
            }
        }
    }
    return null;
}

function require_logger_auth(): void
{
    $expected = (string) (app_config()['logger_key'] ?? '');
    $provided = get_request_header('X-Logger-Key') ?? '';

    if (strlen($provided) > 512) {
        fail_json('Invalid logger key.', 401);
    }
    if (strlen($expected) < 16) {
        fail_json('logger_key is not configured (or shorter than 16 characters).', 503);
    }
    if (!hash_equals($expected, $provided)) {
        fail_json('Invalid logger key.', 401);
    }
}

/* ------------------------------------------------------------------------
 * Error classification (mirrors js/rules.js)
 * --------------------------------------------------------------------- */

function load_error_rules(): array
{
    static $rules = null;
    if (is_array($rules)) {
        return $rules;
    }

    $path = dirname(__DIR__) . '/error_rules.json';
    if (!is_file($path)) {
        throw new RuntimeException('error_rules.json is missing.');
    }
    $decoded = json_decode((string) file_get_contents($path), true);
    if (!is_array($decoded)) {
        throw new RuntimeException('error_rules.json is not valid JSON.');
    }
    return $rules = $decoded;
}

function lower_text(string $text): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
}

function normalize_text(string $text): string
{
    return lower_text(trim(preg_replace('/\s+/u', ' ', $text) ?? $text));
}

function parse_error_string(string $raw): array
{
    $raw = trim($raw);
    $code = '';
    $message = $raw;

    if (preg_match('/\s*\{([^{}]+)\}\s*$/u', $raw, $matches)) {
        $code = trim($matches[1]);
        $message = trim((string) preg_replace('/\s*\{[^{}]+\}\s*$/u', '', $raw));
    }

    return [
        'raw' => $raw,
        'message' => $message,
        'code' => truncate_text($code, 64),
        'normalized_message' => normalize_text($message),
    ];
}

function group_matches(array $group, string $code, string $message): bool
{
    if ($code !== '' && in_array($code, array_map('strval', $group['codes'] ?? []), true)) {
        return true;
    }
    $normalized = normalize_text($message);
    foreach ($group['exact'] ?? [] as $value) {
        if (normalize_text((string) $value) === $normalized) {
            return true;
        }
    }
    foreach ($group['starts'] ?? [] as $prefix) {
        $prefix = normalize_text((string) $prefix);
        if ($prefix !== '' && str_starts_with($normalized, $prefix)) {
            return true;
        }
    }
    foreach ($group['contains'] ?? [] as $needle) {
        $needle = normalize_text((string) $needle);
        if ($needle !== '' && str_contains($normalized, $needle)) {
            return true;
        }
    }
    return false;
}

/**
 * Returns the category used for logging/statistics:
 * null (ignored), 'toner', 'paper', 'critical', 'warning' or 'other'.
 */
function classify_error(array $parsed, array $rules): ?string
{
    $code = (string) ($parsed['code'] ?? '');
    $message = (string) ($parsed['message'] ?? '');

    foreach (['ignore' => null, 'toner' => 'toner', 'paper' => 'paper', 'critical' => 'critical', 'warning' => 'warning'] as $group => $category) {
        if (group_matches($rules[$group] ?? [], $code, $message)) {
            return $category;
        }
    }
    return 'other';
}

function detect_toner_color(array $parsed): ?string
{
    $byCode = ['10072' => 'black', '10073' => 'cyan', '10074' => 'magenta', '10075' => 'yellow'];
    $code = (string) ($parsed['code'] ?? '');
    if (isset($byCode[$code])) {
        return $byCode[$code];
    }

    $message = normalize_text((string) ($parsed['message'] ?? ''));
    $patterns = [
        'waste' => ['brukt toner', 'waste toner', 'resttoner', 'spilltoner'],
        'cyan' => ['cyan'],
        'magenta' => ['magenta'],
        'yellow' => ['gul toner', 'yellow', 'gelb'],
        'black' => ['sort toner', 'svart toner', 'black', 'schwarz'],
    ];
    foreach ($patterns as $color => $needles) {
        foreach ($needles as $needle) {
            if (str_contains($message, $needle)) {
                return $color;
            }
        }
    }
    return null;
}

function detect_paper_tray(array $parsed): ?string
{
    if (preg_match('/(?:magasin|tray|fack|kassette|fach)\s*([0-9]+)/iu', (string) ($parsed['message'] ?? ''), $m)) {
        return substr((string) $m[1], 0, 8);
    }
    return null;
}

function parse_percent(mixed $value): ?int
{
    if (is_int($value) || is_float($value)) {
        return $value < 0 ? null : max(0, min(100, (int) round((float) $value)));
    }
    if (is_string($value) && preg_match('/^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/', $value, $m)) {
        $number = (float) $m[1];
        return $number < 0 ? null : max(0, min(100, (int) round($number)));
    }
    return null;
}

function toner_level_for_color(array $printer, ?string $color): ?int
{
    if ($color === null || $color === 'waste') {
        return null;
    }

    // Newer snapshots describe each supply by name/colour.
    foreach (($printer['Supplies'] ?? []) as $supply) {
        if (is_array($supply) && ($supply['color'] ?? null) === $color) {
            return isset($supply['percent']) ? parse_percent($supply['percent']) : null;
        }
    }

    // Legacy Ricoh layout: 0=black, 1=waste, 2=cyan, 3=magenta, 4=yellow.
    $levels = $printer['Ink Levels'] ?? null;
    $index = ['black' => 0, 'cyan' => 2, 'magenta' => 3, 'yellow' => 4][$color] ?? null;
    if (!is_array($levels) || $index === null || !array_key_exists($index, $levels)) {
        return null;
    }
    return parse_percent($levels[$index]);
}

function incident_fingerprint(array $parsed, ?string $category = null, ?string $tonerColor = null): string
{
    if ($category === 'toner' && $tonerColor !== null) {
        return hash('sha256', 'toner|' . $tonerColor);
    }
    return hash('sha256', ($parsed['normalized_message'] ?? '') . '|' . ($parsed['code'] ?? ''));
}

/** Converts untrusted JSON values to text without warnings for arrays/objects. */
function scalar_text(mixed $value): string
{
    return is_scalar($value) ? (string) $value : '';
}

/** Same algorithm as printerId() in js/printers.js. */
function printer_identifier(array $printer): string
{
    $serial = trim(scalar_text($printer['Serial'] ?? ''));
    if ($serial !== '') {
        return truncate_text('serial:' . $serial, 160);
    }
    $ip = trim(scalar_text($printer['IP'] ?? ''));
    if ($ip !== '') {
        return truncate_text('ip:' . $ip, 160);
    }
    return truncate_text('name:' . trim(scalar_text($printer['Name'] ?? 'unknown')), 160);
}

function snapshot_time(array $printer): string
{
    $tz = app_timezone();
    $now = new DateTimeImmutable('now', $tz);

    // Ignore timestamps that are clearly wrong (bad clock or malformed data).
    $plausible = static fn (DateTimeImmutable $d): bool =>
        $d > $now->modify('-30 days') && $d < $now->modify('+1 day');

    $iso = trim(scalar_text($printer['Timestamp'] ?? ''));
    if ($iso !== '') {
        try {
            $date = (new DateTimeImmutable($iso))->setTimezone($tz);
            if ($plausible($date)) {
                return $date->format('Y-m-d H:i:s');
            }
        } catch (Throwable) {
            // fall back to the legacy field
        }
    }

    $raw = trim(scalar_text($printer['Time'] ?? ''));
    if ($raw !== '') {
        $date = DateTimeImmutable::createFromFormat('d m Y, H:i', $raw, $tz);
        if ($date instanceof DateTimeImmutable && $plausible($date)) {
            return $date->format('Y-m-d H:i:s');
        }
    }

    return $now->format('Y-m-d H:i:s');
}

function seconds_between(string $from, string $to): int
{
    $fromTs = strtotime($from);
    $toTs = strtotime($to);
    return ($fromTs === false || $toTs === false) ? 0 : max(0, $toTs - $fromTs);
}

/* ------------------------------------------------------------------------
 * Periods for statistics
 * --------------------------------------------------------------------- */

function period_bounds(string $period): array
{
    $now = new DateTimeImmutable('now', app_timezone());
    $to = $now->modify('+1 second');

    switch ($period) {
        case 'week':
            $from = $now->modify('-' . ((int) $now->format('N') - 1) . ' days')->setTime(0, 0);
            break;
        case 'month':
            $from = $now->modify('first day of this month')->setTime(0, 0);
            break;
        case 'year':
            $from = $now->setDate((int) $now->format('Y'), 1, 1)->setTime(0, 0);
            break;
        case 'all':
            $from = null;
            break;
        default:
            $period = 'today';
            $from = $now->setTime(0, 0);
    }

    return [
        'key' => $period,
        'from' => $from?->format('Y-m-d H:i:s'),
        'to' => $to->format('Y-m-d H:i:s'),
        'now' => $now->format('Y-m-d H:i:s'),
    ];
}

function date_where(string $column, ?string $from, string $to, array &$params, string $prefix): string
{
    $parts = [];
    if ($from !== null) {
        $parts[] = "{$column} >= :{$prefix}_from";
        $params[":{$prefix}_from"] = $from;
    }
    $parts[] = "{$column} < :{$prefix}_to";
    $params[":{$prefix}_to"] = $to;
    return implode(' AND ', $parts);
}

function fetch_all(PDO $pdo, string $sql, array $params = []): array
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function fetch_one(PDO $pdo, string $sql, array $params = []): ?array
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function scalar_query(PDO $pdo, string $sql, array $params = []): mixed
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchColumn();
}

function truncate_text(string $text, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $length, 'UTF-8');
    }
    return substr($text, 0, $length);
}
