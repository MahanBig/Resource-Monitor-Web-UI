<?php
declare(strict_types=1);

date_default_timezone_set('Europe/Oslo');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    throw new RuntimeException('Mangler api/config.php. Kopier config.example.php og fyll inn databaseinformasjon.');
}

$config = require $configPath;

function app_config(): array
{
    global $config;
    return $config;
}

function logger_settings(): array
{
    $config = app_config();
    $custom = $config['logger'] ?? [];

    return [
        // Toner som har forsvunnet og samtidig ser ut til å være fylt/erstattet.
        'toner_confirm_seconds' => (int) ($custom['toner_confirm_seconds'] ?? 600),
        // Toner som bare forsvinner uten tydelig nivåhopp må være borte lenger.
        'toner_confirm_without_level_seconds' => (int) ($custom['toner_confirm_without_level_seconds'] ?? 1800),
        'toner_full_threshold' => (int) ($custom['toner_full_threshold'] ?? 70),
        'toner_level_jump_threshold' => (int) ($custom['toner_level_jump_threshold'] ?? 30),
    ];
}

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = app_config();
    $db = $config['db'] ?? [];

    foreach (['host', 'name', 'user', 'pass'] as $required) {
        if (!array_key_exists($required, $db) || $db[$required] === '') {
            throw new RuntimeException("Mangler databaseinnstilling: {$required}");
        }
    }

    $charset = $db['charset'] ?? 'utf8mb4';
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        $db['host'],
        $db['name'],
        $charset
    );

    $pdo = new PDO($dsn, $db['user'], $db['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $pdo;
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail_json(string $message, int $status = 500, array $extra = []): never
{
    json_response(array_merge([
        'ok' => false,
        'error' => $message,
    ], $extra), $status);
}

function get_request_header(string $name): ?string
{
    $serverName = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$serverName])) {
        return trim((string) $_SERVER[$serverName]);
    }

    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $headerName => $value) {
            if (strcasecmp($headerName, $name) === 0) {
                return trim((string) $value);
            }
        }
    }

    return null;
}

function require_logger_auth(): void
{
    $config = app_config();
    $expected = (string) ($config['logger_key'] ?? '');
    $provided = get_request_header('X-Logger-Key') ?? '';

    if ($expected === '' || !hash_equals($expected, $provided)) {
        fail_json('Ugyldig logger-nøkkel.', 401);
    }
}

function load_error_rules(): array
{
    static $rules = null;
    if (is_array($rules)) {
        return $rules;
    }

    $path = dirname(__DIR__) . '/error_rules.json';
    if (!is_file($path)) {
        throw new RuntimeException('Mangler error_rules.json.');
    }

    $decoded = json_decode((string) file_get_contents($path), true);
    if (!is_array($decoded)) {
        throw new RuntimeException('error_rules.json er ikke gyldig JSON.');
    }

    $rules = $decoded;
    return $rules;
}

function lower_text(string $text): string
{
    if (function_exists('mb_strtolower')) {
        return mb_strtolower($text, 'UTF-8');
    }
    return strtolower($text);
}

function normalize_text(string $text): string
{
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    return lower_text($text);
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
        'code' => $code,
        'normalized_message' => normalize_text($message),
    ];
}

function list_contains_ci(array $needles, string $haystack): bool
{
    foreach ($needles as $needle) {
        if ($needle === '') {
            continue;
        }

        if (function_exists('mb_stripos')) {
            if (mb_stripos($haystack, (string) $needle, 0, 'UTF-8') !== false) {
                return true;
            }
        } elseif (stripos($haystack, (string) $needle) !== false) {
            return true;
        }
    }
    return false;
}

function list_has_exact_ci(array $values, string $candidate): bool
{
    $candidate = normalize_text($candidate);
    foreach ($values as $value) {
        if (normalize_text((string) $value) === $candidate) {
            return true;
        }
    }
    return false;
}

function group_matches(array $group, string $code, string $message): bool
{
    return ($code !== '' && in_array($code, $group['codes'] ?? [], true))
        || list_contains_ci($group['contains'] ?? [], $message)
        || list_has_exact_ci($group['exact'] ?? [], $message);
}

/**
 * Prioritet er viktig:
 * ignore -> toner -> paper -> critical -> warning -> other.
 * Det hindrer f.eks. "Replace ... toner" fra å bli telt som critical.
 */
function classify_error(array $parsed, array $rules): ?string
{
    $code = (string) ($parsed['code'] ?? '');
    $message = (string) ($parsed['message'] ?? '');

    if (group_matches($rules['ignore'] ?? [], $code, $message)) {
        return null;
    }
    if (group_matches($rules['toner'] ?? [], $code, $message)) {
        return 'toner';
    }
    if (group_matches($rules['paper'] ?? [], $code, $message)) {
        return 'paper';
    }
    if (group_matches($rules['critical'] ?? [], $code, $message)) {
        return 'critical';
    }
    if (group_matches($rules['warning'] ?? [], $code, $message)) {
        return 'warning';
    }

    return 'other';
}

function detect_toner_color(array $parsed): ?string
{
    $code = (string) ($parsed['code'] ?? '');
    $message = normalize_text((string) ($parsed['message'] ?? ''));

    $byCode = [
        '10072' => 'black',
        '10073' => 'cyan',
        '10074' => 'magenta',
        '10075' => 'yellow',
    ];
    if (isset($byCode[$code])) {
        return $byCode[$code];
    }

    if (str_contains($message, 'brukt toner') || str_contains($message, 'waste toner')) {
        return 'waste';
    }
    if (str_contains($message, 'cyan')) {
        return 'cyan';
    }
    if (str_contains($message, 'magenta')) {
        return 'magenta';
    }
    if (str_contains($message, 'gul toner') || str_contains($message, 'yellow toner')) {
        return 'yellow';
    }
    if (str_contains($message, 'sort toner') || str_contains($message, 'black toner')) {
        return 'black';
    }

    return null;
}

function detect_paper_tray(array $parsed): ?string
{
    $message = (string) ($parsed['message'] ?? '');

    if (preg_match('/(?:magasin|tray)\s*([0-9]+)/iu', $message, $m)) {
        return (string) $m[1];
    }

    return null;
}

function parse_percent(mixed $value): ?int
{
    if (is_int($value) || is_float($value)) {
        return max(0, min(100, (int) round((float) $value)));
    }

    if (is_string($value) && preg_match('/(-?\d+(?:\.\d+)?)\s*%?/', $value, $m)) {
        return max(0, min(100, (int) round((float) $m[1])));
    }

    return null;
}

function toner_level_for_color(array $printer, ?string $color): ?int
{
    if ($color === null || $color === 'waste') {
        return null;
    }

    $levels = $printer['Ink Levels'] ?? null;
    if (!is_array($levels)) {
        return null;
    }

    // Ricoh-dataene i prosjektet: 0=sort, 2=cyan, 3=magenta, 4=gul.
    $indexMap = [
        'black' => 0,
        'cyan' => 2,
        'magenta' => 3,
        'yellow' => 4,
    ];

    if (!isset($indexMap[$color])) {
        return null;
    }

    $index = $indexMap[$color];
    return array_key_exists($index, $levels) ? parse_percent($levels[$index]) : null;
}

function incident_fingerprint(array $parsed, ?string $category = null, ?string $tonerColor = null): string
{
    if ($category === 'toner' && $tonerColor !== null) {
        return hash('sha256', 'toner|' . $tonerColor);
    }

    $payload = ($parsed['normalized_message'] ?? '') . '|' . ($parsed['code'] ?? '');
    return hash('sha256', $payload);
}

function printer_identifier(array $printer): string
{
    $serial = trim((string) ($printer['Serial'] ?? ''));
    if ($serial !== '') {
        return 'serial:' . $serial;
    }

    $ip = trim((string) ($printer['IP'] ?? ''));
    if ($ip !== '') {
        return 'ip:' . $ip;
    }

    return 'name:' . trim((string) ($printer['Name'] ?? 'unknown'));
}

function snapshot_time(array $printer): string
{
    $raw = trim((string) ($printer['Time'] ?? ''));
    if ($raw !== '') {
        $date = DateTimeImmutable::createFromFormat('d m Y, H:i', $raw, new DateTimeZone('Europe/Oslo'));
        if ($date instanceof DateTimeImmutable) {
            return $date->format('Y-m-d H:i:s');
        }
    }

    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Oslo')))->format('Y-m-d H:i:s');
}

function seconds_between(string $from, string $to): int
{
    $fromTs = strtotime($from);
    $toTs = strtotime($to);
    if ($fromTs === false || $toTs === false) {
        return 0;
    }
    return max(0, $toTs - $fromTs);
}

function period_bounds(string $period): array
{
    $tz = new DateTimeZone('Europe/Oslo');
    $now = new DateTimeImmutable('now', $tz);
    $to = $now->modify('+1 second');

    switch ($period) {
        case 'week':
            $daysSinceMonday = ((int) $now->format('N')) - 1;
            $from = $now->modify("-{$daysSinceMonday} days")->setTime(0, 0, 0);
            $label = 'Denne uka';
            break;
        case 'month':
            $from = $now->setDate((int) $now->format('Y'), (int) $now->format('m'), 1)->setTime(0, 0, 0);
            $label = 'Denne måneden';
            break;
        case 'year':
            $from = $now->setDate((int) $now->format('Y'), 1, 1)->setTime(0, 0, 0);
            $label = 'I år';
            break;
        case 'all':
            $from = null;
            $label = 'All historikk';
            break;
        case 'today':
        default:
            $period = 'today';
            $from = $now->setTime(0, 0, 0);
            $label = 'I dag';
            break;
    }

    return [
        'key' => $period,
        'label' => $label,
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

function scalar_query(PDO $pdo, string $sql, array $params = []): mixed
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchColumn();
}
