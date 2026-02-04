const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { pool, initDB } = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// --- REST API ---

// ลงทะเบียน / อัพเดทข้อมูลทหาร
app.post("/api/soldiers", async (req, res) => {
  const { callsign, name } = req.body;
  if (!callsign) return res.status(400).json({ error: "callsign required" });
  try {
    const result = await pool.query(
      `INSERT INTO soldiers (callsign, name) VALUES ($1, $2)
       ON CONFLICT (callsign) DO UPDATE SET name = COALESCE($2, soldiers.name)
       RETURNING *`,
      [callsign, name || callsign]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// รายชื่อทหาร (online / ทั้งหมด)
app.get("/api/soldiers", async (req, res) => {
  const onlineOnly = req.query.online === "true";
  const where = onlineOnly ? "WHERE is_online = true" : "";
  const result = await pool.query(`SELECT * FROM soldiers ${where} ORDER BY callsign`);
  res.json(result.rows);
});

// GPS history ย้อนหลัง (รองรับ from/to สำหรับ replay)
app.get("/api/soldiers/:id/track", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const { from, to } = req.query;
  const params = [req.params.id];
  let where = "WHERE soldier_id = $1";
  if (from) { params.push(from); where += ` AND recorded_at >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND recorded_at <= $${params.length}`; }
  params.push(limit);
  const result = await pool.query(
    `SELECT lat, lng, accuracy, recorded_at FROM gps_logs
     ${where} ORDER BY recorded_at DESC LIMIT $${params.length}`,
    params
  );
  res.json(result.rows.reverse());
});

// Health Check
const startTime = Date.now();
app.get("/api/health", async (req, res) => {
  const health = {
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    services: { database: "error", mediamtx: "error", socketio: "running" },
  };
  // Check DB
  try {
    await pool.query("SELECT 1");
    health.services.database = "connected";
  } catch (e) { health.status = "degraded"; }
  // Check MediaMTX API
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`http://${process.env.MEDIAMTX_HOST || "localhost"}:9997/v3/paths/list`, { signal: ctrl.signal });
    clearTimeout(timer);
    health.services.mediamtx = "reachable";
  } catch (e) { health.status = "degraded"; }
  res.json(health);
});

// Dashboard Stats
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [soldiers, sos, lastGps] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_online) AS online FROM soldiers`),
      pool.query(`SELECT COUNT(*) AS active FROM sos_events WHERE status = 'active'`),
      pool.query(`SELECT MAX(recorded_at) AS last_update FROM gps_logs`),
    ]);
    res.json({
      totalSoldiers: parseInt(soldiers.rows[0].total),
      onlineCount: parseInt(soldiers.rows[0].online),
      activeSOS: parseInt(sos.rows[0].active),
      lastUpdateTime: lastGps.rows[0].last_update,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Socket.IO ---

async function broadcastStats() {
  try {
    const [soldiers, sos] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_online) AS online FROM soldiers`),
      pool.query(`SELECT COUNT(*) AS active FROM sos_events WHERE status = 'active'`),
    ]);
    io.emit("dashboard:stats", {
      totalSoldiers: parseInt(soldiers.rows[0].total),
      onlineCount: parseInt(soldiers.rows[0].online),
      activeSOS: parseInt(sos.rows[0].active),
      timestamp: new Date().toISOString(),
    });
  } catch (e) { console.error("broadcastStats error", e.message); }
}

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  // ทหารเข้าร่วมระบบ
  socket.on("soldier:join", async (data) => {
    const { callsign, name } = data;
    if (!callsign) return;

    try {
      const result = await pool.query(
        `INSERT INTO soldiers (callsign, name, stream_path, is_online)
         VALUES ($1, $2, $1, true)
         ON CONFLICT (callsign) DO UPDATE
         SET is_online = true, stream_path = $1,
             name = COALESCE($2, soldiers.name)
         RETURNING *`,
        [callsign, name || callsign]
      );
      const soldier = result.rows[0];
      socket.soldierId = soldier.id;
      socket.callsign = callsign;

      // แจ้ง center ว่ามีทหารเข้ามา
      socket.broadcast.emit("soldier:online", soldier);
      socket.emit("soldier:registered", soldier);
      broadcastStats();
      console.log(`soldier joined: ${callsign} (id=${soldier.id})`);
    } catch (err) {
      console.error("soldier:join error", err.message);
    }
  });

  // อัพเดท GPS
  socket.on("soldier:gps", async (data) => {
    if (!socket.soldierId) return;
    const { lat, lng, accuracy } = data;

    try {
      await pool.query(
        `INSERT INTO gps_logs (soldier_id, lat, lng, accuracy) VALUES ($1, $2, $3, $4)`,
        [socket.soldierId, lat, lng, accuracy]
      );
      // broadcast ไป center
      io.emit("soldier:position", {
        soldierId: socket.soldierId,
        callsign: socket.callsign,
        lat, lng, accuracy,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("soldier:gps error", err.message);
    }
  });

  // อัพเดท stream path (หลัง WHIP publish สำเร็จ)
  socket.on("soldier:stream", async (data) => {
    if (!socket.soldierId) return;
    await pool.query(
      `UPDATE soldiers SET stream_path = $1 WHERE id = $2`,
      [data.streamPath, socket.soldierId]
    );
    io.emit("soldier:stream_update", {
      soldierId: socket.soldierId,
      callsign: socket.callsign,
      streamPath: data.streamPath,
    });
  });

  // SOS — ทหารกดปุ่มฉุกเฉิน
  socket.on("soldier:sos", async (data) => {
    if (!socket.soldierId) return;
    try {
      const result = await pool.query(
        `INSERT INTO sos_events (soldier_id, lat, lng) VALUES ($1, $2, $3) RETURNING *`,
        [socket.soldierId, data.lat, data.lng]
      );
      const sosEvent = result.rows[0];
      io.emit("soldier:sos", {
        sosId: sosEvent.id,
        soldierId: socket.soldierId,
        callsign: socket.callsign,
        lat: data.lat,
        lng: data.lng,
        timestamp: sosEvent.created_at,
      });
      broadcastStats();
      console.log(`SOS from ${socket.callsign} at ${data.lat},${data.lng}`);
    } catch (err) {
      console.error("soldier:sos error", err.message);
    }
  });

  // SOS ยกเลิก
  socket.on("soldier:sos-cancel", async () => {
    if (!socket.soldierId) return;
    try {
      await pool.query(
        `UPDATE sos_events SET status = 'cancelled', resolved_at = NOW()
         WHERE soldier_id = $1 AND status = 'active'`,
        [socket.soldierId]
      );
      io.emit("soldier:sos-cancel", {
        soldierId: socket.soldierId,
        callsign: socket.callsign,
      });
      broadcastStats();
      console.log(`SOS cancelled by ${socket.callsign}`);
    } catch (err) {
      console.error("soldier:sos-cancel error", err.message);
    }
  });

  // disconnect
  socket.on("disconnect", async () => {
    if (!socket.soldierId) return;
    await pool.query(`UPDATE soldiers SET is_online = false WHERE id = $1`, [socket.soldierId]);
    io.emit("soldier:offline", { soldierId: socket.soldierId, callsign: socket.callsign });
    broadcastStats();
    console.log(`soldier left: ${socket.callsign}`);
  });
});

// --- Start ---

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    server.listen(PORT, () => console.log(`API listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("DB init failed, retrying in 3s...", err.message);
    setTimeout(() => {
      initDB().then(() => {
        server.listen(PORT, () => console.log(`API listening on :${PORT}`));
      });
    }, 3000);
  });
