# MediaMTX Patrol Tracking System

ระบบติดตามการลาดตระเวน Real-time — ทหารส่ง Live Video (WebRTC) + GPS จากมือถือ มายังศูนย์บัญชาการผ่าน MediaMTX (WHIP/WHEP)

## สถาปัตยกรรม

```
[ทหาร A/B/C มือถือ] ──WHIP publish──▶ [MediaMTX]
        │                                    │
        │ GPS (Socket.IO)           WHEP subscribe
        ▼                                    ▼
   [Node.js API] ──save──▶ [PostgreSQL]  [Center Dashboard]
        │                                 ├── แผนที่ Leaflet + markers
        │ Socket.IO broadcast            └── Live Video popup
        └───────────────────────────────────▶

┌──────────────────────────────────────────────────────────┐
│                   Docker Compose                         │
│                                                          │
│  ┌─────────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌──────┐    │
│  │MediaMTX*│ │ API    │ │Caddy │ │Postgres│ │Coturn│    │
│  │:8889    │ │ :3000  │ │:80/443│ │ :5432  │ │:3478 │    │
│  └─────────┘ └────────┘ └──────┘ └────────┘ └──────┘    │
│  * host network                                          │
└──────────────────────────────────────────────────────────┘
```

## Services

| Service | Image | หน้าที่ |
|---------|-------|---------|
| **mediamtx** | `bluenviron/mediamtx` (host network) | WebRTC media server — WHIP/WHEP protocol |
| **api** | Node.js (Express + Socket.IO) | REST API + real-time GPS relay + บันทึกลง DB |
| **postgres** | `postgres:16-alpine` | เก็บข้อมูลทหาร + GPS history ย้อนหลัง |
| **caddy** | `caddy:2-alpine` | Reverse proxy + auto HTTPS (Let's Encrypt) |
| **coturn** | `coturn/coturn` | TURN server สำหรับ NAT traversal |

## Quick Start

```bash
# 1. ตั้งค่า
cp .env.example .env
# แก้ DOMAIN เป็น domain จริง, MEDIAMTX_HOST เป็น IP จริงของ server
# ห้ามใช้ host.docker.internal บน Linux — ใช้ IP จริงเท่านั้น

# 2. Start
docker compose up -d --build
```

> **หมายเหตุ:** เมื่อเปลี่ยน `.env` ต้องใช้ `docker compose up -d --force-recreate` ไม่ใช่แค่ `restart`

## หน้าเว็บ

| URL | หน้าที่ |
|-----|---------|
| `https://<DOMAIN>/` | ศูนย์บัญชาการ (center.html) |
| `https://<DOMAIN>/center.html` | แผนที่รวม + ดู live video ทหารแต่ละคน |
| `https://<DOMAIN>/soldier.html` | หน้าทหาร — ส่ง live video + GPS จากมือถือ |

## วิธีใช้งาน

### ทหาร (มือถือ)
1. เปิด `https://<DOMAIN>/soldier.html` บนมือถือ
2. ใส่ Callsign (เช่น Alpha-1) แล้วกด **เริ่มส่งสัญญาณ**
3. อนุญาตกล้อง + GPS → ระบบจะส่ง live video และตำแหน่งอัตโนมัติ

### ศูนย์บัญชาการ
1. เปิด `https://<DOMAIN>/center.html`
2. เห็น marker ทหารแต่ละคนบนแผนที่ (อัพเดท real-time)
3. กดที่ marker → ดู live video ของทหารคนนั้น
4. กด **แสดงเส้นทาง** → ดู track ย้อนหลังบนแผนที่

## API Endpoints

| Method | URL | รายละเอียด |
|--------|-----|------------|
| `POST` | `/api/soldiers` | ลงทะเบียนทหาร `{ callsign, name }` |
| `GET` | `/api/soldiers` | รายชื่อทหารทั้งหมด (`?online=true` เฉพาะ online) |
| `GET` | `/api/soldiers/:id/track` | GPS history ย้อนหลัง (`?limit=500`) |

## Socket.IO Events

| Event | ทิศทาง | ข้อมูล |
|-------|--------|--------|
| `soldier:join` | ทหาร → API | `{ callsign, name, streamPath }` |
| `soldier:gps` | ทหาร → API | `{ lat, lng, accuracy }` |
| `soldier:position` | API → ทุกคน | `{ soldierId, callsign, lat, lng, accuracy }` |
| `soldier:online` | API → ทุกคน | ทหารเข้าระบบ |
| `soldier:offline` | API → ทุกคน | ทหารออกจากระบบ |

## โครงสร้างไฟล์

```
├── docker-compose.yml
├── api/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js              # Express + Socket.IO server
│   └── db.js                  # PostgreSQL connection + schema
├── mediamtx/
│   └── mediamtx.yml           # MediaMTX config (WebRTC, ICE servers)
├── caddy/
│   └── Caddyfile              # Reverse proxy + auto HTTPS
├── coturn/
│   └── turnserver.conf
└── docs/
    ├── center.html            # ศูนย์บัญชาการ (แผนที่ + video)
    └── soldier.html           # หน้าทหาร (ส่ง video + GPS)
```

## Configuration

### TURN Server Credentials

| Key | Value |
|-----|-------|
| Username | `patrol` |
| Password | `patrolpass` |

ต้องตรงกัน 2 ที่: `coturn/turnserver.conf` และ iceServers ใน HTML files

### Caddy (HTTPS)

- ตั้ง `DOMAIN` ใน `.env` → Caddy ขอ Let's Encrypt cert อัตโนมัติ
- WebRTC บนมือถือ **ต้องใช้ HTTPS** (getUserMedia บังคับ secure context)
- Caddyfile ใช้ `handle` blocks จัดลำดับ — proxy routes ต้องอยู่ก่อน file_server

### MediaMTX Network

- MediaMTX ใช้ `network_mode: host` เพื่อให้ ICE candidates เป็น host IP ตรงๆ (แก้ปัญหา ICE failed ใน Docker bridge network)
- `MEDIAMTX_HOST` ใน `.env` ต้องเป็น IP จริงของ server (`host.docker.internal` ใช้ได้แค่ Docker Desktop ไม่ใช่ Linux)

### WHIP/WHEP Protocol

MediaMTX ใช้ HTTP-based signaling แทน WebSocket:

| Protocol | Method | URL | หน้าที่ |
|----------|--------|-----|---------|
| WHIP | POST | `/streams/{streamPath}/whip` | Publish video (ทหาร) |
| WHEP | POST | `/streams/{streamPath}/whep` | Subscribe video (ศูนย์) |

- `streamPath` = callsign ของทหาร
- ไม่ต้องใช้ WebSocket signaling

## Ports

| Port | Service |
|------|---------|
| 80 | Caddy HTTP (→ redirect HTTPS) |
| 443 | Caddy HTTPS (web + proxy) |
| 8889 | MediaMTX WebRTC (WHIP/WHEP) |
| 9997 | MediaMTX API |
| 3478 | Coturn TURN |
| 49152-49200/udp | Coturn relay ports |

## Latency

| แบบ | Latency |
|-----|---------|
| WebRTC (มือถือ → Center) | ~200–500 ms |

## Migration from Janus

โปรเจคนี้ fork มาจาก janus-patrol-tracking และปรับเปลี่ยนดังนี้:

| Before (Janus) | After (MediaMTX) |
|----------------|------------------|
| WebSocket signaling (janus-protocol) | HTTP (WHIP/WHEP) |
| VideoRoom plugin | Stream-based |
| feedId (integer) | stream_path (string) |
| Port 8188 (WS) | Port 8889 (WebRTC) |
| janus_feed column | stream_path column |
| JANUS_HOST env | MEDIAMTX_HOST env |
| janus/januspass TURN | patrol/patrolpass TURN |
