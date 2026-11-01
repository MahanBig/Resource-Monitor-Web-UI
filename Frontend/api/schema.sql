-- Resource Monitor history database (MariaDB / MySQL).
-- The API creates and upgrades these tables automatically on first use,
-- so running this file by hand is only needed if the database user is not
-- allowed to CREATE/ALTER tables. Contains no data or credentials.

CREATE TABLE IF NOT EXISTS app_meta (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS printer_incidents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    printer_id VARCHAR(160) NOT NULL,
    printer_name VARCHAR(160) NOT NULL,
    printer_ip VARCHAR(64) NULL,
    printer_model VARCHAR(160) NULL,

    severity ENUM('critical','warning','toner','paper','other') NOT NULL,

    error_code VARCHAR(64) NULL,
    error_message VARCHAR(500) NOT NULL,
    fingerprint CHAR(64) NOT NULL,

    consumable_color VARCHAR(16) NULL,
    paper_tray VARCHAR(32) NULL,
    toner_level_opened TINYINT UNSIGNED NULL,
    toner_level_last TINYINT UNSIGNED NULL,
    toner_level_resolved TINYINT UNSIGNED NULL,
    resolution_type ENUM('resolved','replaced','refilled') NULL,
    replacement_confirmed_by_level TINYINT(1) NOT NULL DEFAULT 0,

    service_status ENUM('none','reported') NOT NULL DEFAULT 'none',
    service_reported_at DATETIME NULL,
    service_note VARCHAR(500) NULL,
    service_reported_by VARCHAR(100) NULL,

    opened_at DATETIME NOT NULL,
    resolved_at DATETIME NULL,

    PRIMARY KEY (id),
    KEY idx_incidents_opened_at (opened_at),
    KEY idx_incidents_resolved_at (resolved_at),
    KEY idx_incidents_printer (printer_id),
    KEY idx_incidents_severity (severity),
    KEY idx_incidents_fingerprint (fingerprint),
    KEY idx_incidents_open (resolved_at, severity),
    KEY idx_service_active (service_status, resolved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS printer_active_errors (
    printer_id VARCHAR(160) NOT NULL,
    fingerprint CHAR(64) NOT NULL,
    incident_id BIGINT UNSIGNED NOT NULL,
    last_seen_at DATETIME NOT NULL,
    -- Set when a toner warning disappears; used to confirm a real replacement.
    missing_since DATETIME NULL,

    PRIMARY KEY (printer_id, fingerprint),
    UNIQUE KEY uq_active_incident (incident_id),
    KEY idx_active_last_seen (last_seen_at),
    CONSTRAINT fk_active_incident FOREIGN KEY (incident_id)
        REFERENCES printer_incidents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
    ip_hash CHAR(64) NOT NULL PRIMARY KEY,
    failure_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    first_failed_at DATETIME NULL,
    last_failed_at DATETIME NULL,
    blocked_until DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
