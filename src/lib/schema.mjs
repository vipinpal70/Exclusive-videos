// Shared schema used by both the app (auto-migrate on first query) and `npm run db:migrate`.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
    \`key\` VARCHAR(100) NOT NULL PRIMARY KEY,
    \`value\` TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS videos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    link VARCHAR(500) NOT NULL,
    from_chat_id VARCHAR(100) NOT NULL,
    message_id BIGINT NOT NULL,
    chat_title VARCHAR(255) NULL,
    caption TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    verify_status ENUM('unverified','ok','error') NOT NULL DEFAULT 'unverified',
    verify_message VARCHAR(1000) NULL,
    verified_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS members (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    elefin_client_id BIGINT NULL,
    name VARCHAR(255) NULL,
    country VARCHAR(100) NULL,
    affiliated TINYINT(1) NOT NULL DEFAULT 0,
    lots DECIMAL(14,2) NOT NULL DEFAULT 0,
    net_deposit DECIMAL(14,2) NOT NULL DEFAULT 0,
    eligible TINYINT(1) NOT NULL DEFAULT 0,
    lookup_json MEDIUMTEXT NULL,
    last_lookup_at DATETIME NULL,
    email_verified_at DATETIME NULL,
    telegram_id BIGINT NULL UNIQUE,
    telegram_username VARCHAR(100) NULL,
    telegram_name VARCHAR(255) NULL,
    telegram_photo_url VARCHAR(500) NULL,
    telegram_linked_at DATETIME NULL,
    deliveries_count INT NOT NULL DEFAULT 0,
    last_delivered_at DATETIME NULL,
    is_blocked TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS otp_codes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    ip VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_otp_email (email, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS deliveries (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    member_id INT UNSIGNED NOT NULL,
    video_id INT UNSIGNED NULL,
    telegram_id BIGINT NOT NULL,
    status ENUM('sent','failed') NOT NULL,
    telegram_message_id BIGINT NULL,
    error VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_deliveries_member (member_id),
    INDEX idx_deliveries_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS lookup_logs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    found TINYINT(1) NOT NULL DEFAULT 0,
    eligible TINYINT(1) NOT NULL DEFAULT 0,
    lots DECIMAL(14,2) NULL,
    reason VARCHAR(500) NULL,
    ip VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_lookup_ip (ip, created_at),
    INDEX idx_lookup_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// Column additions for existing installs (MySQL 8 has no ADD COLUMN IF NOT EXISTS).
const COLUMNS = [
  { table: "admins", column: "is_super", ddl: "ALTER TABLE admins ADD COLUMN is_super TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash" },
  { table: "admins", column: "permissions", ddl: "ALTER TABLE admins ADD COLUMN permissions TEXT NULL AFTER is_super" },
  // Videos requested on the website while the bot couldn't message the user yet; sent when they press Start in the bot.
  { table: "members", column: "pending_video_ids", ddl: "ALTER TABLE members ADD COLUMN pending_video_ids TEXT NULL AFTER last_delivered_at" },
  // Deliveries before this time are ignored for re-delivery rules (admin "Reset delivery").
  { table: "members", column: "delivery_reset_at", ddl: "ALTER TABLE members ADD COLUMN delivery_reset_at DATETIME NULL AFTER pending_video_ids" },
];

const INDEXES = [
  // Per-video cooldown lookups: last successful delivery of each video to a member.
  { table: "deliveries", name: "idx_deliveries_member_video", ddl: "CREATE INDEX idx_deliveries_member_video ON deliveries (member_id, video_id, status, created_at)" },
];

/** Applies column migrations and data fixes. `run(sql, params)` must return rows for SELECTs. */
export async function migrate(run) {
  for (const c of COLUMNS) {
    const rows = await run(
      "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [c.table, c.column]
    );
    if (Number(rows[0].c) === 0) await run(c.ddl, []);
  }
  for (const i of INDEXES) {
    const rows = await run(
      "SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
      [i.table, i.name]
    );
    if (Number(rows[0].c) === 0) await run(i.ddl, []);
  }
  // Installs that predate permissions: the oldest admin becomes the super admin.
  const supers = await run("SELECT COUNT(*) AS c FROM admins WHERE is_super = 1", []);
  if (Number(supers[0].c) === 0) await run("UPDATE admins SET is_super = 1 ORDER BY id ASC LIMIT 1", []);
}
