# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ระบบติดตามการลาดตระเวน Real-time — ทหารส่ง Live Video (WebRTC) + GPS จากมือถือ มายังศูนย์บัญชาการ ผ่าน MediaMTX (WHIP/WHEP) + Node.js API + PostgreSQL

## Architecture

```
[ทหาร A/B/C มือถือ] ──WHIP publish──▶ [MediaMTX]
        │                                    │
        │ GPS (Socket.IO)           WHEP subscribe
        ▼                                    ▼
   [Node.js API] ──save──▶ [PostgreSQL]  [Center Dashboard]
        │                                 ├── แผนที่ Leaflet + markers
        │ Socket.IO broadcast            └── Live Video popup
        └───────────────────────────────────▶
```

- **MediaMTX** (host network) — WebRTC media server using WHIP for publish, WHEP for subscribe
- **Node.js API** — Express + Socket.IO รับ GPS, จัดการ soldier sessions, บันทึกลง PostgreSQL
- **PostgreSQL** — เก็บข้อมูลทหาร + GPS history ย้อนหลัง
- **Caddy** — reverse proxy /api, /socket.io, /streams + auto HTTPS (Let's Encrypt) + serve static HTML
- **Coturn** — TURN server สำหรับ NAT traversal

## Commands

```bash
# Start all services
docker compose up -d --build

# Restart single service
docker compose restart mediamtx

# View logs
docker compose logs -f api
docker compose logs -f mediamtx

# Test API
curl -s http://localhost/api/soldiers | python3 -m json.tool
curl -X POST http://localhost/api/soldiers -H "Content-Type: application/json" -d '{"callsign":"Alpha-1"}'
curl http://localhost/api/soldiers/1/track

# Test MediaMTX API
curl http://localhost:9997/v3/paths/list
```

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | 5 services: mediamtx (host network), api, postgres, caddy, coturn |
| `api/server.js` | REST API + Socket.IO server (GPS relay, soldier sessions) |
| `api/db.js` | PostgreSQL pool + schema auto-init (soldiers, gps_logs tables) |
| `docs/center.html` | ศูนย์บัญชาการ — Leaflet map + WHEP subscriber |
| `docs/soldier.html` | หน้าทหาร — camera + GPS + WHIP publisher |
| `mediamtx/mediamtx.yml` | MediaMTX config (WebRTC, ICE servers) |
| `caddy/Caddyfile` | Reverse proxy + auto HTTPS; ใช้ env DOMAIN และ MEDIAMTX_HOST |
| `.env.example` | ตัวอย่าง env vars: DOMAIN, MEDIAMTX_HOST |

## Important Notes

- **MediaMTX ใช้ `network_mode: host`** — จำเป็นเพื่อให้ ICE candidates เป็น host IP ตรงๆ
- **WHIP/WHEP protocol** — ใช้ HTTP POST แทน WebSocket signaling
  - WHIP publish: `POST /streams/{streamPath}/whip`
  - WHEP subscribe: `POST /streams/{streamPath}/whep`
- **stream_path = callsign** — ทหารแต่ละคนใช้ callsign เป็น stream path
- **TURN credentials** ต้องตรงกัน 2 ที่: `coturn/turnserver.conf` และ iceServers ใน HTML (default: patrol/patrolpass)
- **Caddy** ใช้ env var `DOMAIN` และ `MEDIAMTX_HOST` จาก `.env`
- **`MEDIAMTX_HOST` ต้องเป็น IP จริงของ server** — `host.docker.internal` ใช้ได้แค่ Docker Desktop ไม่ใช่ Linux
- **เมื่อเปลี่ยน `.env` ต้อง `--force-recreate`** — ไม่ใช่แค่ `restart`
- WebRTC บนมือถือ **ต้องใช้ HTTPS** — Caddy จัดการ cert อัตโนมัติ
- **PostgreSQL healthcheck** — api service จะ wait จนกว่า postgres healthy ก่อน start

## Production Deploy

```bash
cp .env.example .env
# แก้ DOMAIN=your.domain.com
# แก้ MEDIAMTX_HOST=<server IP จริง>
docker compose up -d --build
```

## Database Schema

- `soldiers` — id, callsign (unique), name, stream_path, is_online
- `gps_logs` — id, soldier_id (FK), lat, lng, accuracy, recorded_at (indexed)

## Ports

| Port | Service |
|------|---------|
| 80 | Caddy HTTP (→ redirect HTTPS) |
| 443 | Caddy HTTPS (web + proxy) |
| 8889 | MediaMTX WebRTC (WHIP/WHEP) |
| 9997 | MediaMTX API |
| 3478 | Coturn TURN |
| 49152-49200/udp | Coturn relay ports |

## Migration from Janus

โปรเจคนี้ fork มาจาก janus-patrol-tracking และปรับเปลี่ยนดังนี้:

| Before (Janus) | After (MediaMTX) |
|----------------|------------------|
| WebSocket signaling (janus-protocol) | HTTP (WHIP/WHEP) |
| VideoRoom plugin | Stream-based |
| feedId (integer) | stream_path (string) |
| Port 8188 (WS) | Port 8889 (WebRTC) |
| janus_feed column | stream_path column |
