<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';
require_once __DIR__ . '/lang.php';

function admin_security_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    if (admin_is_https()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

/**
 * HTTPS detection. X-Forwarded-Proto is honoured only to decide the Secure
 * cookie flag / HSTS (spoofing it can only make the attacker's cookie stricter).
 */
function admin_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function admin_config(): array
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
            throw new RuntimeException('admin/config.php must return an array.');
        }
        $config = $loaded;
    }

    // Environment variables (Docker) override the file.
    foreach (['ADMIN_USERNAME' => 'username', 'ADMIN_PASSWORD_HASH' => 'password_hash'] as $env => $key) {
        $value = getenv($env);
        if ($value !== false && $value !== '') {
            $config[$key] = $value;
        }
    }

    if (empty($config['username']) || (empty($config['password']) && empty($config['password_hash']))) {
        throw new RuntimeException('Admin credentials are not configured.');
    }
    return $config;
}

function admin_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $config = admin_config();
    $secure = admin_is_https();

    // Reject session IDs the server did not create (session fixation) and never put them in URLs.
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');

    session_name((string) ($config['session_name'] ?? 'rm_admin'));
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/admin/index.php')), '/') . '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();

    $timeoutMinutes = max(15, (int) ($config['session_timeout_minutes'] ?? 480));
    $lastSeen = (int) ($_SESSION['admin_last_seen'] ?? 0);
    if ($lastSeen > 0 && time() - $lastSeen > $timeoutMinutes * 60) {
        $_SESSION = [];
        session_regenerate_id(true);
    }

    $_SESSION['admin_last_seen'] = time();
}

function admin_escape(mixed $value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function admin_csrf_token(): string
{
    if (empty($_SESSION['admin_csrf'])) {
        $_SESSION['admin_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['admin_csrf'];
}

function admin_require_csrf(): void
{
    $expected = (string) ($_SESSION['admin_csrf'] ?? '');
    $provided = (string) ($_POST['csrf'] ?? '');
    if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
        http_response_code(400);
        exit(t('bad_csrf'));
    }
}

function admin_is_logged_in(): bool
{
    return !empty($_SESSION['admin_authenticated']) && !empty($_SESSION['admin_username']);
}

function admin_client_ip_hash(): string
{
    // REMOTE_ADDR on purpose: client-controlled proxy headers are not trusted.
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return hash('sha256', $ip);
}

function admin_rate_limit_state(PDO $pdo): array
{
    $stmt = $pdo->prepare(
        'SELECT failure_count, first_failed_at, last_failed_at, blocked_until
         FROM admin_login_attempts WHERE ip_hash = :ip_hash'
    );
    $stmt->execute([':ip_hash' => admin_client_ip_hash()]);
    return $stmt->fetch() ?: [];
}

function admin_is_blocked(PDO $pdo): bool
{
    $state = admin_rate_limit_state($pdo);
    if (empty($state['blocked_until'])) {
        return false;
    }

    $until = strtotime((string) $state['blocked_until']);
    return $until !== false && $until > time();
}

function admin_record_failed_login(PDO $pdo): void
{
    $config = admin_config();
    $maxFailures = max(3, (int) ($config['max_failures'] ?? 5));
    $windowMinutes = max(5, (int) ($config['failure_window_minutes'] ?? 15));
    $blockMinutes = max(5, (int) ($config['block_minutes'] ?? 15));
    $state = admin_rate_limit_state($pdo);
    $now = new DateTimeImmutable('now');

    $firstFailedAt = !empty($state['first_failed_at'])
        ? new DateTimeImmutable((string) $state['first_failed_at'])
        : null;

    if ($firstFailedAt === null || $firstFailedAt < $now->modify("-{$windowMinutes} minutes")) {
        $count = 1;
        $first = $now->format('Y-m-d H:i:s');
    } else {
        $count = ((int) ($state['failure_count'] ?? 0)) + 1;
        $first = $firstFailedAt->format('Y-m-d H:i:s');
    }

    $blockedUntil = $count >= $maxFailures
        ? $now->modify("+{$blockMinutes} minutes")->format('Y-m-d H:i:s')
        : null;

    $stmt = $pdo->prepare(
        'INSERT INTO admin_login_attempts
            (ip_hash, failure_count, first_failed_at, last_failed_at, blocked_until)
         VALUES
            (:ip_hash, :failure_count, :first_failed_at, :last_failed_at, :blocked_until)
         ON DUPLICATE KEY UPDATE
            failure_count = VALUES(failure_count),
            first_failed_at = VALUES(first_failed_at),
            last_failed_at = VALUES(last_failed_at),
            blocked_until = VALUES(blocked_until)'
    );
    $stmt->execute([
        ':ip_hash' => admin_client_ip_hash(),
        ':failure_count' => $count,
        ':first_failed_at' => $first,
        ':last_failed_at' => $now->format('Y-m-d H:i:s'),
        ':blocked_until' => $blockedUntil,
    ]);
}

function admin_clear_failed_logins(PDO $pdo): void
{
    $stmt = $pdo->prepare('DELETE FROM admin_login_attempts WHERE ip_hash = :ip_hash');
    $stmt->execute([':ip_hash' => admin_client_ip_hash()]);
}

function admin_verify_credentials(string $username, string $password): bool
{
    $config = admin_config();
    $expectedUser = (string) ($config['username'] ?? '');

    // Very long inputs are never legitimate and only cost CPU.
    if (strlen($username) > 200 || strlen($password) > 1024) {
        return false;
    }

    // The password is always checked, even for a wrong username, so response
    // time does not reveal whether the username exists.
    $passwordOk = admin_verify_password($password, $config);
    $userOk = $expectedUser !== '' && hash_equals($expectedUser, $username);
    return $userOk && $passwordOk;
}

function admin_verify_password(string $password, array $config): bool
{
    $hashString = (string) ($config['password_hash'] ?? '');
    $passwordConfig = $config['password'] ?? [];

    // "pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>" (tools/hash-password.py)
    if (str_starts_with($hashString, 'pbkdf2_sha256$')) {
        $parts = explode('$', $hashString);
        if (count($parts) !== 4) {
            return false;
        }
        $passwordConfig = ['iterations' => $parts[1], 'salt' => $parts[2], 'hash' => $parts[3]];
    } elseif ($hashString !== '') {
        // Native PHP hashes: php -r 'echo password_hash("secret", PASSWORD_DEFAULT);'
        $info = password_get_info($hashString);
        return ($info['algo'] ?? null) !== null && $info['algo'] !== 0 && password_verify($password, $hashString);
    }

    $iterations = (int) ($passwordConfig['iterations'] ?? 0);
    $salt = base64_decode((string) ($passwordConfig['salt'] ?? ''), true);
    $expectedHash = base64_decode((string) ($passwordConfig['hash'] ?? ''), true);

    if ($iterations < 100000 || $iterations > 10000000 || $salt === false || strlen($salt) < 8
        || $expectedHash === false || strlen($expectedHash) !== 32) {
        return false;
    }

    $calculated = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    return hash_equals($expectedHash, $calculated);
}

function admin_login(string $username): void
{
    session_regenerate_id(true);
    $_SESSION['admin_authenticated'] = true;
    $_SESSION['admin_username'] = $username;
    $_SESSION['admin_last_seen'] = time();
    $_SESSION['admin_csrf'] = bin2hex(random_bytes(32));
}

function admin_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
}

/** Stores a translation key, so the message follows the chosen language. */
function admin_flash(string $key, string $type = 'ok'): void
{
    $_SESSION['admin_flash'] = ['key' => $key, 'type' => $type];
}

function admin_take_flash(): ?array
{
    $flash = $_SESSION['admin_flash'] ?? null;
    unset($_SESSION['admin_flash']);
    return is_array($flash) ? $flash : null;
}
