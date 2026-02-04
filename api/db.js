const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "patrol",
  user: process.env.DB_USER || "patrol",
  password: process.env.DB_PASS || "patrol123",
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS soldiers (
      id SERIAL PRIMARY KEY,
      callsign VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100),
      stream_path VARCHAR(100),
      is_online BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS gps_logs (
      id SERIAL PRIMARY KEY,
      soldier_id INT REFERENCES soldiers(id),
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      accuracy REAL,
      recorded_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gps_soldier ON gps_logs(soldier_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS sos_events (
      id SERIAL PRIMARY KEY,
      soldier_id INTEGER REFERENCES soldiers(id),
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
  `);
  console.log("DB initialized");
}

module.exports = { pool, initDB };
