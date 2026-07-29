const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'fmo_smart_queue.db');
const db = new sqlite3.Database(dbPath);

// Promisified database helpers for async/await
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

async function initSchema() {
  await dbRun(`PRAGMA foreign_keys = ON;`);

  // Personnel Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS personnel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_code VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      role_type VARCHAR(20) CHECK(role_type IN ('DIRECTOR', 'STAFF', 'ADMIN', 'OPERATOR')) NOT NULL,
      department VARCHAR(100) NOT NULL,
      position VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      email VARCHAR(100),
      line_user_id VARCHAR(100),
      password VARCHAR(255),
      menu_permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure missing columns exist
  try { await dbRun(`ALTER TABLE personnel ADD COLUMN password VARCHAR(255);`); } catch (e) {}
  try { await dbRun(`ALTER TABLE personnel ADD COLUMN menu_permissions TEXT;`); } catch (e) {}

  // Auto Migration: อัปเดต CHECK Constraint ให้รองรับ 'ADMIN' และ 'OPERATOR'
  try {
    const masterSql = await dbGet(`SELECT sql FROM sqlite_master WHERE type='table' AND name='personnel';`);
    if (masterSql && masterSql.sql && (!masterSql.sql.includes('ADMIN') || !masterSql.sql.includes('OPERATOR'))) {
      console.log('🔄 Migrating personnel table CHECK constraint to support ADMIN & OPERATOR roles...');
      await dbRun(`BEGIN TRANSACTION;`);
      await dbRun(`CREATE TABLE personnel_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emp_code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        role_type VARCHAR(20) CHECK(role_type IN ('DIRECTOR', 'STAFF', 'ADMIN', 'OPERATOR')) NOT NULL,
        department VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(100),
        line_user_id VARCHAR(100),
        password VARCHAR(255),
        menu_permissions TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
      await dbRun(`INSERT INTO personnel_new (id, emp_code, name, role_type, department, position, phone, email, line_user_id, created_at) SELECT id, emp_code, name, role_type, department, position, phone, email, line_user_id, created_at FROM personnel;`);
      await dbRun(`DROP TABLE personnel;`);
      await dbRun(`ALTER TABLE personnel_new RENAME TO personnel;`);
      await dbRun(`COMMIT;`);
      console.log('✅ Personnel table migrated to support ADMIN & OPERATOR roles successfully!');
    }
  } catch (mErr) {
    console.error('Migration error (personnel table):', mErr);
    try { await dbRun(`ROLLBACK;`); } catch (e) {}
  }



  // Queue State Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS queue_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_type VARCHAR(20) UNIQUE NOT NULL,
      current_round INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Queue Members Status Tracking
  await dbRun(`
    CREATE TABLE IF NOT EXISTS queue_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personnel_id INTEGER UNIQUE NOT NULL,
      role_type VARCHAR(20) NOT NULL,
      current_round INTEGER DEFAULT 1,
      queue_order INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'WAITING',
      hold_reason TEXT,
      hold_timestamp DATETIME,
      last_assigned_at DATETIME,
      FOREIGN KEY(personnel_id) REFERENCES personnel(id) ON DELETE CASCADE
    );
  `);

  // Missions Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_title VARCHAR(200) NOT NULL,
      description TEXT,
      location VARCHAR(200),
      dress_code VARCHAR(150),
      start_date DATETIME NOT NULL,
      end_date DATETIME NOT NULL,
      required_directors INTEGER DEFAULT 1,
      required_staff INTEGER DEFAULT 1,
      status VARCHAR(20) DEFAULT 'SCHEDULED',
      created_by VARCHAR(100) DEFAULT 'Admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Mission Assignments Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS mission_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER NOT NULL,
      personnel_id INTEGER NOT NULL,
      role_type VARCHAR(20) NOT NULL,
      assigned_round INTEGER NOT NULL,
      is_leader BOOLEAN DEFAULT 0,
      assignment_status VARCHAR(20) DEFAULT 'JOINED',
      substituted_for_personnel_id INTEGER,
      notes TEXT,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY(personnel_id) REFERENCES personnel(id) ON DELETE CASCADE
    );
  `);

  // Ensure missing columns exist if table was previously created
  try { await dbRun(`ALTER TABLE missions ADD COLUMN dress_code VARCHAR(150);`); } catch (e) {}
  try { await dbRun(`ALTER TABLE mission_assignments ADD COLUMN substituted_for_personnel_id INTEGER;`); } catch (e) {}
  try { await dbRun(`ALTER TABLE mission_assignments ADD COLUMN notes TEXT;`); } catch (e) {}
  try { await dbRun(`ALTER TABLE mission_assignments ADD COLUMN ack_status VARCHAR(20) DEFAULT 'PENDING_ACK';`); } catch (e) {}
  try { await dbRun(`ALTER TABLE mission_assignments ADD COLUMN ack_at DATETIME;`); } catch (e) {}
  try { await dbRun(`ALTER TABLE mission_assignments ADD COLUMN decline_reason TEXT;`); } catch (e) {}
  try { await dbRun(`ALTER TABLE missions ADD COLUMN mission_code VARCHAR(50);`); } catch (e) {}

  // Notification Logs Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER,
      personnel_id INTEGER,
      channel VARCHAR(20) NOT NULL, -- 'LINE_GROUP' or 'EMAIL'
      recipient VARCHAR(200) NOT NULL,
      subject_title TEXT,
      content_body TEXT,
      status VARCHAR(20) DEFAULT 'SENT',
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
  `);

  // Queue Swaps Table (Peer Swap Request)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS queue_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      role_type VARCHAR(20) NOT NULL,
      reason TEXT,
      status VARCHAR(20) DEFAULT 'APPROVED',
      approved_by VARCHAR(100) DEFAULT 'ADMIN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(requester_id) REFERENCES personnel(id) ON DELETE CASCADE,
      FOREIGN KEY(target_id) REFERENCES personnel(id) ON DELETE CASCADE
    );
  `);

  // Ensure Queue State entries exist

  await dbRun(`INSERT OR IGNORE INTO queue_state (role_type, current_round) VALUES ('DIRECTOR', 1);`);
  await dbRun(`INSERT OR IGNORE INTO queue_state (role_type, current_round) VALUES ('STAFF', 1);`);
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initSchema
};
