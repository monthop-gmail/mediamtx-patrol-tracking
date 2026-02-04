# MediaMTX Patrol Tracking — Demo Enhancement Plan

> **เป้าหมาย:** ปรับปรุงระบบให้ demo ได้ครบฟีเจอร์สำคัญ ดูเป็น production-ready command center
>
> **Repo:** `https://github.com/monthop-gmail/mediamtx-patrol-tracking`
>
> **Tech Stack:** Node.js (Express + Socket.IO), PostgreSQL, MediaMTX (WHIP/WHEP), Leaflet, Docker Compose

---

## Phase 1 — SOS / Panic Button (ความสำคัญ: สูงสุด)

**เป้าหมาย:** ทหารกดปุ่มฉุกเฉินได้ ศูนย์เห็นแจ้งเตือนทันที

### 1.1 ฝั่ง soldier.html

- เพิ่มปุ่ม SOS สีแดงขนาดใหญ่ ตำแหน่งมุมล่างขวา (fixed position, z-index สูง)
- กด hold 1 วินาที เพื่อป้องกันกดโดนโดยบังเอิญ (long press)
- เมื่อ activate → emit Socket.IO event:

```js
socket.emit('soldier:sos', {
  soldierId,
  callsign,
  lat: currentLat,
  lng: currentLng,
  timestamp: new Date().toISOString()
});
```

- แสดง UI feedback ว่า "ส่ง SOS แล้ว" พร้อมปุ่ม "ยกเลิก SOS"
- emit `soldier:sos-cancel` เมื่อกดยกเลิก

### 1.2 ฝั่ง server.js (API)

- รับ event `soldier:sos` แล้ว broadcast ไป **ทุก client** ด้วย `io.emit('soldier:sos', data)`
- บันทึก SOS event ลง PostgreSQL (สร้างตาราง `sos_events`):

```sql
CREATE TABLE IF NOT EXISTS sos_events (
  id SERIAL PRIMARY KEY,
  soldier_id INTEGER REFERENCES soldiers(id),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status VARCHAR(20) DEFAULT 'active',  -- active | cancelled | resolved
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
```

- รับ event `soldier:sos-cancel` → update status = 'cancelled', broadcast `soldier:sos-cancel`

### 1.3 ฝั่ง center.html

- เมื่อได้รับ `soldier:sos`:
  - marker ของทหารคนนั้น → เปลี่ยนเป็นไอคอนกะพริบแดง (CSS animation pulse)
  - แสดง notification banner ด้านบน: "⚠️ SOS จาก Alpha-1 — คลิกเพื่อดูตำแหน่ง"
  - เล่นเสียง alert (ใช้ Web Audio API หรือ `<audio>` element, เตรียมไฟล์ mp3 ไว้ใน docs/)
  - pan แผนที่ไปยังตำแหน่ง SOS อัตโนมัติ
- เมื่อได้รับ `soldier:sos-cancel` → คืน marker เป็นปกติ, ปิด notification

---

## Phase 2 — Status Sidebar + Soldier List (ความสำคัญ: สูง)

**เป้าหมาย:** เห็นภาพรวมทหารทั้งหมดได้ทันทีโดยไม่ต้องคลิก marker

### 2.1 แก้ไข center.html — เพิ่ม sidebar ซ้าย

- Layout: sidebar ซ้าย (280px) + แผนที่ขวา (ที่เหลือ)
- Sidebar ประกอบด้วย:
  - **หัว:** "กำลังพล" + จำนวน online/total (เช่น "3/5 Online")
  - **รายการทหาร:** แต่ละคนแสดง:
    - 🟢/🔴 สถานะ online/offline
    - Callsign + ชื่อ
    - พิกัดล่าสุด (lat, lng) ตัวเล็กๆ
    - ปุ่ม "ดู Video" → เปิด video popup / pan ไปที่ marker
    - ถ้ามี SOS active → แสดง badge แดงกะพริบ
  - **ส่วนล่าง:** เวลาปัจจุบัน + สถิติ (จำนวน online, SOS active)

### 2.2 แก้ไข server.js — เพิ่ม API ข้อมูลสรุป

```
GET /api/dashboard/stats
→ { totalSoldiers, onlineCount, activeSOS, lastUpdateTime }
```

### 2.3 Socket.IO — เพิ่ม event สรุป

- เมื่อมีทหาร online/offline → ส่ง `dashboard:stats` update ไปทุก client

---

## Phase 3 — Video Grid View (ความสำคัญ: สูง)

**เป้าหมาย:** ดู live video หลายคนพร้อมกันแบบ grid ไม่ต้อง popup ทีละคน

### 3.1 เพิ่มโหมดแสดงผลบน center.html

- เพิ่มปุ่ม toggle: "🗺️ แผนที่" / "📹 Video Grid" ที่ด้านบน
- **โหมดแผนที่** = หน้าเดิม (Leaflet map)
- **โหมด Video Grid:**
  - แสดง video ทหารที่ online ทั้งหมดในรูปแบบ grid
  - Auto layout: 1 คน = full, 2 คน = 1x2, 3-4 คน = 2x2, 5-6 คน = 2x3, 7-9 คน = 3x3
  - แต่ละ cell แสดง:
    - `<video>` element ที่ subscribe ผ่าน WHEP
    - overlay: callsign + สถานะ GPS + ปุ่ม fullscreen
  - กดที่ video → ขยาย fullscreen ใน cell นั้น

### 3.2 WHEP subscription logic

- สร้าง function `subscribeWHEP(streamPath, videoElement)` ที่:
  - POST ไป `http://${MEDIAMTX_HOST}:8889/streams/${streamPath}/whep`
  - รับ SDP answer → set remote description
  - handle ICE candidates
  - attach stream ไป `videoElement.srcObject`
- เมื่อทหาร offline → แสดง placeholder "ไม่มีสัญญาณ" ใน cell

### 3.3 ข้อควรระวัง

- WebRTC connection ทุก cell ใช้ resource → จำกัด max 9 concurrent streams
- ถ้าเกิน 9 → แสดง warning + ให้เลือก filter ว่าจะดูใครบ้าง

---

## Phase 4 — Geofence / Zone Alert (ความสำคัญ: ปานกลาง-สูง)

**เป้าหมาย:** วาดเขตพื้นที่บนแผนที่ แจ้งเตือนเมื่อทหารออกนอกเขต

### 4.1 ฝั่ง center.html — UI วาด geofence

- เพิ่มปุ่ม "วาดเขตพื้นที่" บน toolbar ของแผนที่
- ใช้ Leaflet.draw plugin (`leaflet-draw`):
  - วาด polygon / circle / rectangle
  - ตั้งชื่อ zone (เช่น "เขตปลอดภัย", "เขตอันตราย")
  - เลือกประเภท: `safe` (แจ้งเตือนเมื่อออก) หรือ `danger` (แจ้งเตือนเมื่อเข้า)
  - กดบันทึก → ส่งไป API

### 4.2 ฝั่ง server.js — บันทึกและตรวจสอบ geofence

- ตาราง PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS geofences (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  type VARCHAR(10) DEFAULT 'safe',   -- safe | danger
  geojson JSONB NOT NULL,            -- GeoJSON polygon
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geofence_alerts (
  id SERIAL PRIMARY KEY,
  geofence_id INTEGER REFERENCES geofences(id),
  soldier_id INTEGER REFERENCES soldiers(id),
  alert_type VARCHAR(20),            -- entered | exited
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- API endpoints:

```
POST   /api/geofences          — สร้าง geofence ใหม่
GET    /api/geofences          — ดึง geofence ทั้งหมด
DELETE /api/geofences/:id      — ลบ geofence
```

- ใน handler `soldier:gps` → ทุกครั้งที่รับ GPS:
  - ตรวจสอบว่าพิกัดอยู่ใน/นอก geofence (ใช้ point-in-polygon algorithm)
  - ใช้ library: `@turf/boolean-point-in-polygon` หรือเขียน ray-casting เอง
  - ถ้า status เปลี่ยน (เข้า/ออก) → broadcast `geofence:alert` event
  - บันทึกลง `geofence_alerts`

### 4.3 ฝั่ง center.html — แสดง geofence + alert

- โหลด geofence ทั้งหมดตอนเปิดหน้า → วาด polygon บนแผนที่ (สีเขียว = safe, สีแดง = danger)
- เมื่อได้รับ `geofence:alert` → แสดง notification banner + เสียง

---

## Phase 5 — Replay / Playback Mode (ความสำคัญ: ปานกลาง)

**เป้าหมาย:** ดูการเคลื่อนไหวของทหารย้อนหลังแบบ animation

### 5.1 ฝั่ง center.html — Playback UI

- เพิ่มปุ่ม "ย้อนหลัง" บน toolbar
- เมื่อกด → แสดง:
  - date picker (เลือกวัน)
  - time range slider (เช่น 08:00 - 17:00)
  - ปุ่ม Play / Pause / Speed (1x, 2x, 5x, 10x)
  - เลือกทหารที่ต้องการดู (checkbox)
- เมื่อกด Play:
  - ดึงข้อมูลจาก `GET /api/soldiers/:id/track?from=...&to=...`
  - animate marker เคลื่อนที่ตาม GPS points ด้วย timestamp
  - วาดเส้นทาง polyline ตามหลัง marker
  - แสดง timestamp ปัจจุบันของ playback บน UI

### 5.2 ฝั่ง server.js — ปรับ track API

- ปรับ `GET /api/soldiers/:id/track` ให้รับ query params เพิ่ม:

```
GET /api/soldiers/:id/track?from=2025-01-01T08:00:00Z&to=2025-01-01T17:00:00Z&limit=1000
```

- เรียง results ตาม timestamp ascending

---

## Phase 6 — UI/UX Polish (ความสำคัญ: ปานกลาง)

**เป้าหมาย:** ทำให้หน้าตาดู professional สำหรับ demo

### 6.1 Connection Status Bar (ทั้ง soldier.html และ center.html)

- แสดง status bar ด้านบน:
  - 🟢 "เชื่อมต่อปกติ" (Socket.IO connected + WebRTC connected)
  - 🟡 "กำลังเชื่อมต่อ..." (reconnecting)
  - 🔴 "ขาดการเชื่อมต่อ" (disconnected)
- ฝั่ง soldier.html เพิ่มแสดงสถานะ:
  - กล้อง: ✅ ส่ง video อยู่ / ❌ ไม่สามารถเข้าถึงกล้อง
  - GPS: ✅ ส่งตำแหน่งอยู่ / ❌ ไม่สามารถเข้าถึง GPS
  - Server: ✅ เชื่อมต่อ / ❌ ขาดการเชื่อมต่อ

### 6.2 Auto Reconnect Logic

- Socket.IO: เปิด `reconnection: true` (ปกติเปิดอยู่แล้ว) + แสดง UI เมื่อ reconnecting
- WebRTC (WHIP): เมื่อ `iceConnectionState === 'failed'` หรือ `'disconnected'`:
  - รอ 3 วินาที → ลอง WHIP publish ใหม่
  - retry สูงสุด 5 ครั้ง
  - แสดง retry count บน UI

### 6.3 ปรับ Design ให้ดูเป็น Command Center

- ใช้ dark theme (พื้นหลังเข้ม #1a1a2e หรือคล้ายกัน)
- font: ใช้ monospace สำหรับ callsign/พิกัด
- Leaflet map: ใช้ dark tile layer เช่น CartoDB Dark Matter
- สี accent: เขียว (#00ff88) สำหรับ online, แดง (#ff4444) สำหรับ alert

---

## Phase 7 — เพิ่มเติม (ถ้ามีเวลา)

### 7.1 Authentication (Basic)

- เพิ่ม middleware ง่ายๆ: ตรวจ Bearer token หรือ basic auth
- หน้า login ง่ายๆ (username + password → ได้ token)
- แยก role: `soldier` เข้าได้แค่ soldier.html, `commander` เข้าได้ center.html
- เก็บ users ในตาราง PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'soldier',  -- soldier | commander | admin
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.2 Health Check Endpoint

```
GET /api/health
→ {
    status: "ok",
    services: {
      database: "connected",
      mediamtx: "reachable",      // เช็คผ่าน HTTP ไป port 9997
      socketio: "running"
    },
    uptime: 3600,
    timestamp: "2025-..."
  }
```

### 7.3 PWA สำหรับ soldier.html

- เพิ่ม `manifest.json`:

```json
{
  "name": "Patrol Tracker",
  "short_name": "Patrol",
  "start_url": "/soldier.html",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#00ff88",
  "icons": [{ "src": "icon-192.png", "sizes": "192x192", "type": "image/png" }]
}
```

- เพิ่ม basic service worker สำหรับ offline shell

### 7.4 Screenshot / Evidence Capture

- ฝั่ง center.html: ปุ่ม "📷 ถ่ายภาพ" ใต้ video popup
- ใช้ `canvas.drawImage(videoElement)` → `canvas.toBlob()` → ส่ง POST `/api/evidence`
- บันทึกพร้อม metadata: soldier_id, timestamp, GPS ล่าสุด
- ตาราง:

```sql
CREATE TABLE IF NOT EXISTS evidence (
  id SERIAL PRIMARY KEY,
  soldier_id INTEGER REFERENCES soldiers(id),
  image_data BYTEA,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 8 — Camera Switch: สลับกล้องหน้า/หลัง (ความสำคัญ: สูง)

**เป้าหมาย:** ทหารสลับกล้องหน้า-หลังได้ระหว่างลาดตระเวน โดยไม่ต้อง reconnect ทั้งระบบ

### 8.1 ฝั่ง soldier.html — UI สลับกล้อง

- เพิ่มปุ่ม "🔄 สลับกล้อง" (ไอคอน camera-rotate) อยู่ถัดจากปุ่ม SOS
- เก็บ state ปัจจุบัน: `currentFacingMode = 'environment'` (กล้องหลัง = ค่าเริ่มต้น) หรือ `'user'` (กล้องหน้า)
- เมื่อกดปุ่ม:

```js
// 1. สลับ facingMode
currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

// 2. ขอ stream ใหม่จากกล้องที่เลือก
const newStream = await navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: { exact: currentFacingMode },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: true
});

// 3. Replace track ใน RTCPeerConnection (ไม่ต้อง renegotiate)
const videoTrack = newStream.getVideoTracks()[0];
const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
await sender.replaceTrack(videoTrack);

// 4. อัปเดต local preview
localVideo.srcObject = newStream;

// 5. หยุด track เก่าเพื่อปิดไฟกล้อง
oldVideoTrack.stop();
```

### 8.2 ข้อสำคัญทางเทคนิค

- **`replaceTrack()` ไม่ต้อง renegotiate SDP** — ฝั่งศูนย์บัญชาการเห็น video เปลี่ยนทันทีโดยไม่มี interruption
- **Fallback:** ถ้ามือถือมีกล้องเดียว (เช่น tablet บางรุ่น) → ซ่อนปุ่มสลับกล้อง ตรวจสอบด้วย:

```js
const devices = await navigator.mediaDevices.enumerateDevices();
const videoInputs = devices.filter(d => d.kind === 'videoinput');
if (videoInputs.length < 2) {
  switchCameraBtn.style.display = 'none';
}
```

- **`{ exact: facingMode }`** บางมือถืออาจไม่ support `exact` → fallback เป็น `{ ideal: facingMode }`
- **Audio track:** ใช้ audio track เดิมหรือจาก newStream ก็ได้ ไม่ต้อง replace audio sender ถ้าไม่เปลี่ยน

### 8.3 แจ้ง center ว่ากล้องเปลี่ยน (optional)

- emit event แจ้งศูนย์:

```js
socket.emit('soldier:camera-switch', {
  soldierId,
  facingMode: currentFacingMode  // 'user' | 'environment'
});
```

- ฝั่ง center แสดง badge เล็กๆ บน video: "📷 หน้า" หรือ "📷 หลัง"

---

## Phase 9 — 2-Way Audio: ศูนย์สั่งการพูดคุยกับทหาร (ความสำคัญ: สูง)

**เป้าหมาย:** ผู้บัญชาการกดปุ่มแล้วพูดกับทหารคนที่เลือกได้ (push-to-talk หรือ toggle)

### 9.1 สถาปัตยกรรมเสียง 2 ทิศทาง

ระบบปัจจุบันเป็น **1-way**: ทหาร → ศูนย์ (WHIP publish → WHEP subscribe)

เพิ่มเป็น **2-way** มี 2 แนวทาง เลือกตามความเหมาะสม:

**แนวทาง A — ใช้ MediaMTX เพิ่ม stream ย้อนกลับ (แนะนำ)**

```
ทหาร A ──WHIP publish──▶ stream "alpha-1"     ──WHEP subscribe──▶ ศูนย์ (video+audio)
ศูนย์   ──WHIP publish──▶ stream "cmd-to-alpha-1" ──WHEP subscribe──▶ ทหาร A (audio only)
```

- ศูนย์ publish audio-only stream ชื่อ `cmd-to-{callsign}` ไปยัง MediaMTX
- ทหาร subscribe WHEP stream `cmd-to-{callsign}` เพื่อรับเสียงจากศูนย์
- ข้อดี: ใช้ infrastructure เดิม (MediaMTX) ไม่ต้องเพิ่ม signaling ใหม่

**แนวทาง B — ใช้ Socket.IO relay (ง่ายกว่า แต่ latency สูงกว่า)**

- ศูนย์จับ audio → encode เป็น chunk → ส่งผ่าน Socket.IO → ทหารเล่นผ่าน Web Audio API
- เหมาะสำหรับ demo เร็วๆ แต่คุณภาพเสียงต่ำกว่า

### 9.2 แนวทาง A — รายละเอียด Implementation (แนะนำ)

#### ฝั่ง center.html — ส่งเสียงไปหาทหาร

- เพิ่มปุ่ม "🎙️ พูด" ในแต่ละ video cell / popup ของทหาร
- มี 2 โหมด:
  - **Push-to-Talk (PTT):** กดค้างปุ่มเพื่อพูด ปล่อยเพื่อหยุด (เหมาะกับ demo สไตล์วิทยุ)
  - **Toggle:** กดเปิด/ปิดไมค์ (เหมาะกับการคุยต่อเนื่อง)
- เมื่อกดพูด:

```js
// 1. ขอ audio จาก mic ศูนย์
const cmdStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },
  video: false  // audio only
});

// 2. สร้าง PeerConnection สำหรับ WHIP publish (audio-only)
const cmdPC = new RTCPeerConnection({ iceServers });
cmdStream.getAudioTracks().forEach(track => {
  cmdPC.addTrack(track, cmdStream);
});

// 3. WHIP publish ไป stream "cmd-to-{callsign}"
const offer = await cmdPC.createOffer();
await cmdPC.setLocalDescription(offer);

const res = await fetch(
  `http://${MEDIAMTX_HOST}:8889/streams/cmd-to-${callsign}/whip`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: cmdPC.localDescription.sdp
  }
);
const answer = await res.text();
await cmdPC.setRemoteDescription({ type: 'answer', sdp: answer });
```

- เมื่อปล่อยปุ่ม (PTT) หรือกด toggle off:
  - `cmdStream.getAudioTracks().forEach(t => t.stop())`
  - `cmdPC.close()`
  - DELETE WHIP session (ถ้า MediaMTX support) หรือปล่อย timeout

#### ฝั่ง soldier.html — รับเสียงจากศูนย์

- เมื่อ soldier เชื่อมต่อสำเร็จ → subscribe WHEP stream `cmd-to-{myCallsign}` ด้วย:

```js
async function listenForCommand(callsign) {
  const cmdPC = new RTCPeerConnection({ iceServers });
  cmdPC.addTransceiver('audio', { direction: 'recvonly' });

  const offer = await cmdPC.createOffer();
  await cmdPC.setLocalDescription(offer);

  const res = await fetch(
    `http://${MEDIAMTX_HOST}:8889/streams/cmd-to-${callsign}/whep`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: cmdPC.localDescription.sdp
    }
  );

  if (res.ok) {
    const answer = await res.text();
    await cmdPC.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  cmdPC.ontrack = (event) => {
    const audioEl = document.getElementById('cmdAudio') || document.createElement('audio');
    audioEl.id = 'cmdAudio';
    audioEl.autoplay = true;
    audioEl.srcObject = event.streams[0];
    document.body.appendChild(audioEl);
  };

  return cmdPC;
}
```

- **ปัญหา timing:** stream `cmd-to-{callsign}` อาจยังไม่มีตอนทหารเชื่อมต่อ (เพราะศูนย์ยังไม่ได้กด PTT)
- **แก้ไข:** ใช้ Socket.IO แจ้ง:
  - ศูนย์กด PTT → emit `cmd:ptt-start` `{ targetCallsign }`
  - ทหารรับ event → เริ่ม WHEP subscribe `cmd-to-{callsign}`
  - ศูนย์ปล่อย PTT → emit `cmd:ptt-stop` `{ targetCallsign }`
  - ทหารรับ event → ปิด WHEP connection + แสดง UI "ศูนย์หยุดพูด"

### 9.3 UI บน soldier.html — แสดงสถานะรับเสียง

- แสดง indicator เมื่อศูนย์กำลังพูด: "📢 ศูนย์สั่งการกำลังพูด..." (แถบสีเหลืองกะพริบ)
- เล่นเสียง beep สั้นๆ ตอนเริ่ม/จบ PTT (เหมือนวิทยุสื่อสาร)
- ถ้าเป็น toggle mode → แสดง "🔊 ช่องสื่อสารเปิดอยู่"

### 9.4 Socket.IO Events ใหม่

| Event | ทิศทาง | ข้อมูล |
|---|---|---|
| `cmd:ptt-start` | ศูนย์ → server → ทหารเป้าหมาย | `{ targetCallsign, commanderName }` |
| `cmd:ptt-stop` | ศูนย์ → server → ทหารเป้าหมาย | `{ targetCallsign }` |
| `cmd:ptt-ack` | ทหาร → server → ศูนย์ | `{ callsign, status: 'listening' }` |

### 9.5 ข้อควรระวัง

- **Echo cancellation:** ฝั่ง soldier ต้องเปิด `echoCancellation: true` บน audio constraint เพื่อกัน feedback loop (เสียงศูนย์วนกลับผ่าน mic ทหาร)
- **Audio autoplay policy:** browser บางตัวบล็อก autoplay audio → ต้อง interact กับหน้าก่อน (เช่น กดปุ่ม "เริ่มส่งสัญญาณ" ที่มีอยู่แล้ว ถือว่า user gesture)
- **ศูนย์พูดกับหลายคนพร้อมกัน:** สร้าง WHIP connection แยกต่อทหารแต่ละคน หรือทำ "broadcast to all" โดย publish stream `cmd-broadcast` แล้วทุกทหาร subscribe

---

## Phase 10 — Selective Video Display: เลือกดูบางจอ (ความสำคัญ: ปานกลาง-สูง)

**เป้าหมาย:** ศูนย์สั่งการเลือกได้ว่าจะดู video ของใครบ้าง ไม่ต้องเปิดทุกคนพร้อมกัน เพื่อประหยัด bandwidth และ focus เฉพาะคนที่สนใจ

### 10.1 ฝั่ง center.html — Selective Video Panel

- ปรับ sidebar (Phase 2) ให้แต่ละทหารมี **toggle switch** "📹" ข้างชื่อ:
  - ON = subscribe WHEP + แสดง video ใน grid
  - OFF = ปิด WHEP connection + ปลด video จาก grid
- เพิ่มปุ่มลัดด้านบน sidebar:
  - "เปิดทั้งหมด" — subscribe ทุกคนที่ online
  - "ปิดทั้งหมด" — unsubscribe ทุกคน
  - "เฉพาะ SOS" — เปิดเฉพาะคนที่มี SOS active

### 10.2 Video Slot Management

```js
// จัดการ active video connections
const activeVideos = new Map(); // callsign → { pc, videoElement, whepSession }

async function openVideo(callsign, streamPath) {
  if (activeVideos.has(callsign)) return; // เปิดอยู่แล้ว

  const pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  // WHEP subscribe
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(`${MEDIAMTX_URL}/streams/${streamPath}/whep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp
  });
  const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });

  // สร้าง video element ใน grid
  const videoEl = createVideoCell(callsign);
  pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; };

  activeVideos.set(callsign, { pc, videoElement: videoEl });
  reLayoutGrid(); // ปรับ grid ตามจำนวน active videos
}

function closeVideo(callsign) {
  const entry = activeVideos.get(callsign);
  if (!entry) return;
  entry.pc.close();
  entry.videoElement.remove();
  activeVideos.delete(callsign);
  reLayoutGrid();
}
```

### 10.3 Dynamic Grid Layout

- Grid ปรับตาม **จำนวน video ที่เปิดจริง** (ไม่ใช่จำนวนทหาร online):

```js
function reLayoutGrid() {
  const count = activeVideos.size;
  const grid = document.getElementById('videoGrid');
  if (count === 0) { grid.style.display = 'none'; return; }
  if (count === 1) { grid.style.gridTemplateColumns = '1fr'; }
  else if (count === 2) { grid.style.gridTemplateColumns = '1fr 1fr'; }
  else if (count <= 4) { grid.style.gridTemplateColumns = '1fr 1fr'; }
  else if (count <= 6) { grid.style.gridTemplateColumns = '1fr 1fr 1fr'; }
  else { grid.style.gridTemplateColumns = '1fr 1fr 1fr'; } // max 3 col
}
```

### 10.4 Pin / Priority Video

- แต่ละ video cell มีปุ่ม "📌 Pin":
  - Pin แล้ว → video cell นั้นแสดงขนาดใหญ่กว่าคนอื่น (span 2 columns) + อยู่ตำแหน่งแรกเสมอ
  - Pin ได้สูงสุด 1 คน (กด pin คนใหม่ → คนเก่า unpin)
- ใช้ CSS grid span:

```css
.video-cell.pinned {
  grid-column: span 2;
  grid-row: span 2;
  order: -1;  /* อยู่ก่อนเสมอ */
}
```

### 10.5 ข้อควรระวัง

- **จำกัด max concurrent:** ไม่ควรเปิดเกิน 9 video พร้อมกัน (bandwidth + CPU)
- ถ้าเปิดครบ 9 แล้วกดเปิดคนที่ 10 → แสดง warning "เกินจำนวนสูงสุด กรุณาปิดบางจอก่อน"
- **Cleanup เมื่อทหาร offline:** ถ้าทหารที่เปิด video อยู่ disconnect → auto close video + แสดง placeholder "สูญเสียสัญญาณ"

---

## สรุปลำดับการทำงาน

| ลำดับ | Phase | สถานะ | Impact ต่อ Demo |
|:---:|:---:|:---:|:---:|
| 1 | SOS Button | ✅ Done | ⭐⭐⭐⭐⭐ |
| 2.1 | Sidebar Stats Footer | ✅ Done | ⭐⭐⭐⭐ |
| 2.2 | Dashboard Stats API | ✅ Done | ⭐⭐⭐⭐ |
| 2.3 | Dashboard Stats Broadcast | ✅ Done | ⭐⭐⭐⭐ |
| 3 | Video Grid | ✅ Done | ⭐⭐⭐⭐⭐ |
| 4 | Geofence | ❌ Pending | ⭐⭐⭐⭐ |
| 5.1 | Replay Playback UI | ❌ Pending | ⭐⭐⭐ |
| 5.2 | Track API from/to | ✅ Done | ⭐⭐⭐ |
| 6.1 | Connection Status Bar | ✅ Done | ⭐⭐⭐⭐ |
| 6.2 | Auto Reconnect | ✅ Done | ⭐⭐⭐⭐ |
| 6.3 | Dark Theme | ✅ Done | ⭐⭐⭐⭐ |
| 7.1 | Authentication | ❌ Pending | ⭐⭐⭐ |
| 7.2 | Health Check | ✅ Done | ⭐⭐⭐ |
| 7.3 | PWA Manifest | ✅ Done | ⭐⭐⭐ |
| 7.4 | Screenshot Capture | ✅ Done | ⭐⭐⭐ |
| **8** | **Camera Switch** | **✅ Done** | **⭐⭐⭐⭐** |
| **9** | **2-Way Audio (PTT)** | **❌ Pending** | **⭐⭐⭐⭐⭐** |
| **10** | **Selective Video** | **✅ Done** | **⭐⭐⭐⭐** |

### ความคืบหน้า: 14/18 รายการ (78%)

**เหลือ 4 รายการ:**
- Phase 4 — Geofence / Zone Alert
- Phase 5.1 — Replay Playback UI
- Phase 7.1 — Authentication
- Phase 9 — 2-Way Audio (PTT)

---

## Dependencies ที่ต้องเพิ่ม (npm)

```bash
# ฝั่ง api/
npm install @turf/boolean-point-in-polygon @turf/helpers   # geofence check

# ฝั่ง frontend (CDN ใน HTML)
# Leaflet Draw — https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js
# CartoDB Dark Tile — https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png
```

---

## หมายเหตุสำหรับ Claude Code

- อ่านไฟล์ต้นฉบับทั้งหมดก่อนแก้: `server.js`, `db.js`, `center.html`, `soldier.html`, `docker-compose.yml`
- ทุก Phase สามารถทำแยกกันได้ (independent) แต่แนะนำทำตามลำดับ
- ทดสอบแต่ละ Phase ด้วย `docker compose up -d --build` หลังแก้ไข
- อย่าลืม run `CREATE TABLE` ใหม่ใน db.js สำหรับตารางที่เพิ่ม
- Socket.IO events ใหม่ทุกตัวต้องเพิ่มทั้ง emit (ฝั่งส่ง) และ listener (ฝั่งรับ)
- เก็บ SOS alert sound ไว้ใน `docs/` folder (ใช้ไฟล์ mp3 เล็กๆ หรือ generate ด้วย Web Audio API)
- **Phase 8 (Camera Switch):** ใช้ `replaceTrack()` ซึ่งเปลี่ยน track โดยไม่ต้อง renegotiate SDP — ฝั่งรับเห็น video เปลี่ยนทันที
- **Phase 9 (2-Way Audio):** ใช้ WHIP/WHEP ย้อนกลับผ่าน MediaMTX เหมือน stream ปกติ ต้องประสาน timing ผ่าน Socket.IO (PTT start/stop events)
- **Phase 10 (Selective Video):** ต้อง manage PeerConnection lifecycle อย่างระวัง — close PC เมื่อปิด video, สร้างใหม่เมื่อเปิด ไม่ reuse PC เก่า
