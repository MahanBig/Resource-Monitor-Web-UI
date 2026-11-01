<?php
declare(strict_types=1);

require __DIR__ . '/auth.php';

admin_language(); // may set the language cookie, so it must run before any output
admin_security_headers();

$e = 'admin_escape';

try {
    admin_start_session();
    $pdo = db();
} catch (Throwable $exception) {
    error_log('admin init: ' . $exception->getMessage());
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    exit(t('not_configured'));
}

function admin_redirect(): never
{
    header('Location: ./');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string) ($_POST['action'] ?? '');

    if ($action === 'login') {
        admin_require_csrf();

        if (admin_is_blocked($pdo)) {
            admin_flash('blocked', 'error');
        } else {
            $username = trim((string) ($_POST['username'] ?? ''));
            $password = (string) ($_POST['password'] ?? '');

            if (admin_verify_credentials($username, $password)) {
                admin_clear_failed_logins($pdo);
                admin_login($username);
                admin_flash('logged_in');
            } else {
                admin_record_failed_login($pdo);
                usleep(700000); // slow down automated guessing
                admin_flash('bad_login', 'error');
            }
        }
        admin_redirect();
    }

    if (!admin_is_logged_in()) {
        http_response_code(403);
        exit(t('not_logged_in'));
    }

    admin_require_csrf();

    if ($action === 'logout') {
        admin_logout();
        admin_redirect();
    }

    $incidentId = filter_input(INPUT_POST, 'incident_id', FILTER_VALIDATE_INT);
    if (!$incidentId || $incidentId < 1) {
        admin_flash('bad_id', 'error');
        admin_redirect();
    }

    if ($action === 'report_service' || $action === 'update_note') {
        $note = truncate_text(trim((string) ($_POST['service_note'] ?? '')), 500);

        $stmt = $pdo->prepare(
            "UPDATE printer_incidents
             SET service_status = 'reported',
                 service_reported_at = COALESCE(service_reported_at, :service_reported_at),
                 service_note = :service_note,
                 service_reported_by = :service_reported_by
             WHERE id = :id
               AND resolved_at IS NULL
               AND severity IN ('critical','warning','other')"
        );
        $stmt->execute([
            ':service_reported_at' => (new DateTimeImmutable('now', app_timezone()))->format('Y-m-d H:i:s'),
            ':service_note' => $note !== '' ? $note : null,
            ':service_reported_by' => truncate_text((string) $_SESSION['admin_username'], 100),
            ':id' => $incidentId,
        ]);
        $stmt->rowCount() > 0 ? admin_flash('reported_ok') : admin_flash('reported_fail', 'error');
    } elseif ($action === 'clear_service') {
        $stmt = $pdo->prepare(
            "UPDATE printer_incidents
             SET service_status = 'none', service_reported_at = NULL,
                 service_note = NULL, service_reported_by = NULL
             WHERE id = :id AND resolved_at IS NULL"
        );
        $stmt->execute([':id' => $incidentId]);
        admin_flash('cleared');
    }

    admin_redirect();
}

$flash = admin_take_flash();
$loggedIn = admin_is_logged_in();
$blocked = !$loggedIn && admin_is_blocked($pdo);
$incidents = [];

if ($loggedIn) {
    $incidents = $pdo->query(
        "SELECT id, printer_name, printer_model, severity,
                error_message, error_code, opened_at,
                service_status, service_reported_at, service_note, service_reported_by
         FROM printer_incidents
         WHERE resolved_at IS NULL AND severity IN ('critical','warning','other')
         ORDER BY
           CASE service_status WHEN 'reported' THEN 0 ELSE 1 END,
           FIELD(severity, 'critical', 'warning', 'other'),
           opened_at ASC"
    )->fetchAll();
}

function format_admin_datetime(?string $value): string
{
    if (!$value) {
        return '–';
    }
    try {
        return (new DateTimeImmutable($value, app_timezone()))->format('d.m.Y H:i');
    } catch (Throwable) {
        return $value;
    }
}

function format_admin_duration(int $seconds): string
{
    $seconds = max(0, $seconds);
    $minutes = intdiv($seconds, 60);
    $hours = intdiv($minutes, 60);
    if ($seconds < 60) return $seconds . ' s';
    if ($minutes < 60) return $minutes . ' min';
    if ($hours < 24) return $hours . ' h ' . ($minutes % 60) . ' min';
    return intdiv($hours, 24) . ' d ' . ($hours % 24) . ' h';
}

$csrf = admin_csrf_token();
$lang = admin_language();
?>
<!doctype html>
<html lang="<?= $e($lang) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title><?= $e(t('title')) ?></title>
  <link rel="icon" href="../favicon.ico">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <a class="back-link" href="../"><?= $e('← ' . t('back')) ?></a>
        <h1><?= $e(t('title')) ?></h1>
        <p class="muted"><?= $e(t('subtitle')) ?></p>
      </div>
      <div class="topbar-actions">
        <nav class="lang-switch" aria-label="<?= $e(t('language')) ?>">
          <?php foreach (ADMIN_LANGUAGES as $code => $name): ?>
            <a href="?lang=<?= $e($code) ?>" <?= $code === $lang ? 'aria-current="true"' : '' ?>><?= $e($name) ?></a>
          <?php endforeach; ?>
        </nav>
        <?php if ($loggedIn): ?>
          <form method="post">
            <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
            <input type="hidden" name="action" value="logout">
            <button type="submit" class="btn btn-ghost"><?= $e(t('logout')) ?></button>
          </form>
        <?php endif; ?>
      </div>
    </header>

    <?php if ($flash): ?>
      <div class="flash flash-<?= $flash['type'] === 'error' ? 'error' : 'ok' ?>" role="status">
        <?= $e(t((string) ($flash['key'] ?? ''))) ?>
      </div>
    <?php endif; ?>

    <?php if (!$loggedIn): ?>
      <section class="card login-card">
        <h2><?= $e(t('login')) ?></h2>
        <?php if ($blocked): ?>
          <p class="flash flash-error"><?= $e(t('blocked')) ?></p>
        <?php endif; ?>
        <form method="post" autocomplete="on">
          <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
          <input type="hidden" name="action" value="login">
          <label><?= $e(t('username')) ?>
            <input type="text" name="username" autocomplete="username" required <?= $blocked ? 'disabled' : '' ?>>
          </label>
          <label><?= $e(t('password')) ?>
            <input type="password" name="password" autocomplete="current-password" required <?= $blocked ? 'disabled' : '' ?>>
          </label>
          <button type="submit" class="btn btn-primary" <?= $blocked ? 'disabled' : '' ?>><?= $e(t('login')) ?></button>
        </form>
      </section>
    <?php else: ?>
      <p class="intro"><?= $e(t('intro', ['count' => count($incidents)])) ?></p>

      <section class="incident-list">
        <?php if (!$incidents): ?>
          <div class="card empty"><?= $e(t('none')) ?></div>
        <?php endif; ?>

        <?php foreach ($incidents as $incident): ?>
          <?php
            $reported = $incident['service_status'] === 'reported';
            $severity = (string) $incident['severity'];
            $openedTs = strtotime((string) $incident['opened_at']) ?: time();
          ?>
          <article class="card incident <?= $reported ? 'is-reported' : '' ?> severity-<?= $e($severity) ?>">
            <div class="incident-head">
              <div>
                <span class="pill pill-<?= $e($severity) ?>"><?= $e(t('severity_' . $severity)) ?></span>
                <?php if ($reported): ?><span class="pill pill-service"><?= $e(t('reported_pill')) ?></span><?php endif; ?>
                <h2><?= $e($incident['printer_name']) ?> <small><?= $e($incident['printer_model']) ?></small></h2>
              </div>
              <span class="incident-id">#<?= (int) $incident['id'] ?></span>
            </div>

            <p class="message">
              <?= $e($incident['error_message']) ?>
              <?php if (!empty($incident['error_code'])): ?><code><?= $e($incident['error_code']) ?></code><?php endif; ?>
            </p>

            <div class="meta">
              <span><?= $e(t('opened', ['time' => format_admin_datetime($incident['opened_at'])])) ?></span>
              <span><?= $e(t('active_for', ['duration' => format_admin_duration(time() - $openedTs)])) ?></span>
              <?php if ($reported): ?>
                <span><?= $e(t('reported_at', ['time' => format_admin_datetime($incident['service_reported_at'])])) ?></span>
              <?php endif; ?>
            </div>

            <form method="post" class="service-form">
              <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
              <input type="hidden" name="incident_id" value="<?= (int) $incident['id'] ?>">
              <label><?= $e(t('note')) ?> <small class="muted"><?= $e(t('note_hint')) ?></small>
                <textarea name="service_note" maxlength="500" rows="2" placeholder="<?= $e(t('note_placeholder')) ?>"><?= $e($incident['service_note']) ?></textarea>
              </label>
              <div class="actions">
                <?php if ($reported): ?>
                  <button type="submit" name="action" value="update_note" class="btn btn-primary"><?= $e(t('save_note')) ?></button>
                  <button type="submit" name="action" value="clear_service" class="btn btn-danger" formnovalidate><?= $e(t('clear_service')) ?></button>
                <?php else: ?>
                  <button type="submit" name="action" value="report_service" class="btn btn-primary"><?= $e(t('report_service')) ?></button>
                <?php endif; ?>
              </div>
            </form>
          </article>
        <?php endforeach; ?>
      </section>
    <?php endif; ?>
  </main>
</body>
</html>
