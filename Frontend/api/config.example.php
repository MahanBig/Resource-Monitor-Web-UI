<?php
/*
 * Copy to api/config.php and fill in. Never commit config.php.
 * Every value can also be given as an environment variable instead
 * (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, LOGGER_KEY, APP_TIMEZONE, DATA_FILE).
 */
return [
    'db' => [
        'host' => 'localhost',
        'name' => 'DATABASE_NAME',
        'user' => 'DATABASE_USER',
        'pass' => 'DATABASE_PASSWORD',
        'charset' => 'utf8mb4',
    ],

    // Must be identical to logger.key in Backend/config.json (min. 16 characters).
    // Generate one with:  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
    'logger_key' => 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET',

    // Used for statistics periods ("today", "this week") and timestamps.
    'timezone' => 'Europe/Oslo',

    // Optional tuning of toner-replacement detection (seconds / percent).
    // 'logger' => [
    //     'toner_confirm_seconds' => 600,
    //     'toner_confirm_without_level_seconds' => 1800,
    //     'toner_full_threshold' => 70,
    //     'toner_level_jump_threshold' => 30,
    // ],
];
