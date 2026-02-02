# Janus Patrol Tracking System

ระบบติดตามการลาดตระเวน Real-time — ทหารส่ง Live Video + GPS จากมือถือ มายังศูนย์บัญชาการผ่าน WebRTC

## สถาปัตยกรรม

```
[ทหาร A/B/C มือถือ] ──WebRTC publish──▶ [Janus VideoRoom]
        │                                       │
        │ GPS (Socket.IO)               subscribe│
        ▼                                       ▼
   [Node.js API] ──save──▶ [PostgreSQL]    [Center Dashboard]
        │                                  ├── แผนที่ Leaflet + markers
        │ Socket.IO broadcast             └── Live Video popup
        └──────────────────────────────────────▶

┌──────────────────────────────────────────────────────┐
│                   Docker Compose                     │
│                                                      │
│  ┌────────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌──────┐ │
│  │ Janus* │ │ API    │ │Caddy │ │Postgres│ │Coturn│ │
│  │ :8188  │ │ :3000  │ │:80/443│ │ :5432  │ │:3478 │ │
│  └────────┘ └────────┘ └──────┘ └────────┘ └──────┘ │
│  * host network                                      │
└──────────────────────────────────────────────────────┘
```

## Services

| Service | Image | หน้าที่ |
|---------|-------|---------|
| **janus** | `canyan/janus-gateway` (host network) | WebRTC media server — VideoRoom plugin |
| **api** | Node.js (Express + Socket.IO) | REST API + real-time GPS relay + บันทึกลง DB |
| **postgres** | `postgres:16-alpine` | เก็บข้อมูลทหาร + GPS history ย้อนหลัง |
| **caddy** | `caddy:2-alpine` | Reverse proxy + auto HTTPS (Let's Encrypt) |
| **coturn** | `coturn/coturn` | TURN server สำหรับ NAT traversal |

## Demo

**Production:** https://radsys-claude.sumana.org

## Quick Start

```bash
# 1. ตั้งค่า
cp .env.example .env
# แก้ DOMAIN เป็น domain จริง, JANUS_HOST เป็น IP จริงของ server
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
| `soldier:join` | ทหาร → API | `{ callsign, name, janusFeed }` |
| `soldier:gps` | ทหาร → API | `{ lat, lng, accuracy }` |
| `soldier:feed` | ทหาร → API | `{ feedId }` (Janus VideoRoom feed ID) |
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
├── janus/
│   ├── janus.jcfg             # Config หลัก (NAT/TURN)
│   ├── janus.transport.websockets.jcfg
│   └── janus.plugin.streaming.jcfg
├── caddy/
│   └── Caddyfile              # Reverse proxy + auto HTTPS
├── coturn/
│   └── turnserver.conf
└── docs/
    ├── center.html            # ศูนย์บัญชาการ (แผนที่ + video)
    ├── soldier.html           # หน้าทหาร (ส่ง video + GPS)
    └── test.html              # ทดสอบ WebRTC พื้นฐาน
```

## Configuration

### TURN Server Credentials

| Key | Value |
|-----|-------|
| Username | `janus` |
| Password | `januspass` |

ต้องตรงกัน 3 ที่: `coturn/turnserver.conf`, `janus/janus.jcfg`, และ iceServers ใน HTML files

### Caddy (HTTPS)

- ตั้ง `DOMAIN` ใน `.env` → Caddy ขอ Let's Encrypt cert อัตโนมัติ
- WebRTC บนมือถือ **ต้องใช้ HTTPS** (getUserMedia บังคับ secure context)
- Caddyfile ใช้ `handle` blocks จัดลำดับ — proxy routes ต้องอยู่ก่อน file_server

### Janus Network

- Janus ใช้ `network_mode: host` เพื่อให้ ICE candidates เป็น host IP ตรงๆ (แก้ปัญหา ICE failed ใน Docker bridge network)
- `JANUS_HOST` ใน `.env` ต้องเป็น IP จริงของ server (`host.docker.internal` ใช้ได้แค่ Docker Desktop ไม่ใช่ Linux)

### ส่ง Stream ด้วย FFmpeg (เสริม)

```bash
ffmpeg -re -i input.mp4 \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -f rtp rtp://localhost:5004
```

## Latency

| แบบ | Latency |
|-----|---------|
| WebRTC (มือถือ → Center) | ~200–500 ms |
| RTSP → Janus → WebRTC | ~1 s |
