<?php
return [
    'db' => [
        // Domeneshop: typisk DATABASENAVN.mysql.domeneshop.no
        'host' => 'DATABASENAVN.mysql.domeneshop.no',
        'name' => 'DATABASENAVN',
        'user' => 'DATABASEBRUKER',
        'pass' => 'DATABASEPASSORD',
        'charset' => 'utf8mb4',
    ],

    // Må være identisk med logger_key i Backend/credentials.json.
    // Lag f.eks. med: python3 -c "import secrets; print(secrets.token_urlsafe(48))"
    'logger_key' => 'BYTT_TIL_EN_LANG_TILFELDIG_NOKKEL',
];
