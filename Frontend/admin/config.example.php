<?php
declare(strict_types=1);

/*
 * Copy to admin/config.php. Never commit config.php.
 * Alternatively set the ADMIN_USERNAME and ADMIN_PASSWORD_HASH environment variables.
 *
 * Create the password hash with ONE of:
 *   python3 tools/hash-password.py
 *   php -r 'echo password_hash("your-password", PASSWORD_DEFAULT), PHP_EOL;'
 */
return [
    'username' => 'admin',
    'password_hash' => 'PASTE_THE_HASH_HERE',

    'session_name' => 'rm_admin',
    'session_timeout_minutes' => 480,

    // Simple brute-force protection, stored in the database.
    'max_failures' => 5,
    'failure_window_minutes' => 15,
    'block_minutes' => 15,
];
