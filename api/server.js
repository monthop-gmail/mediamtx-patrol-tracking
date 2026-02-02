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

// GPS history ย้อนหลัง
app.get("/api/soldiers/:id/track", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const result = await pool.query(
    `SELECT lat, lng, accuracy, recorded_at FROM gps_logs
     WHERE soldier_id = $1 ORDER BY recorded_at DESC LIMIT $2`,
    [req.params.id, limit]
  );
  res.json(result.rows.reverse());
});

// --- Socket.IO ---

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

  // disconnect
  socket.on("disconnect", async () => {
    if (!socket.soldierId) return;
    await pool.query(`UPDATE soldiers SET is_online = false WHERE id = $1`, [socket.soldierId]);
    io.emit("soldier:offline", { soldierId: socket.soldierId, callsign: socket.callsign });
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
