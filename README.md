# HoloConnect AI

A software prototype for intelligent, 5G-ready holographic-style telepresence. It renders an actual local/remote camera stream inside a layered receiver display. This is a visual simulation; it does not create an optical hologram or guarantee 5G service.

## Architecture

```text
apps/web       Next.js App Router + React + TypeScript; camera UI, hologram and WebRTC peer
apps/api       Express REST API + Socket.IO room/signaling service
packages/shared Shared participant and signaling types
prisma         PostgreSQL data model (users, sessions, participants, settings)
docker-compose.yml  local PostgreSQL, API/signaling, and web services
```

Media travels over WebRTC. Socket.IO carries room events and SDP/ICE signaling only. A public STUN server is configured by default; add TURN credentials for reliable connectivity across restrictive networks. AI chat uses a labeled local demo adapter unless `AI_PROVIDER_URL` and `AI_PROVIDER_API_KEY` are configured.

Browser TURN settings are visible to the browser. Use short-lived TURN credentials for production deployments rather than embedding a permanent relay password.

## Run locally

Requirements: Node.js 20+, npm 10+, and Docker (for PostgreSQL/account persistence).

1. Copy `.env.example` to `.env` and set a private `JWT_SECRET`.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install packages: `npm install`.
4. Generate the Prisma client and create tables: `npm run db:generate` then `npm run db:migrate`.
5. Start web and API: `npm run dev`.
6. Open <http://localhost:3000>. Use two browser windows to create and join a room.

Alternatively, start the entire container stack with `docker compose up --build` (the API container runs Prisma migrations on startup).

The simulator and camera preview work without PostgreSQL. Registration and login require the database. Browser camera access works on localhost or HTTPS. The API keeps active rooms in memory; restarting the API clears those rooms. Persistent history and settings are represented in the schema but are not yet connected to the active-room service.

## Two-browser call walkthrough

Open the app in two browsers. In the first, click **Create new session**, allow media access, and copy the invite. In the second, open the invite (or enter its room code), allow media access, and join. The API must be running. If ICE negotiation fails on a restricted network, configure TURN in the environment; STUN alone cannot guarantee a path. The UI reports connection failure rather than claiming the call connected.

## API

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me`
- `POST /api/sessions`, `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/join`, `/leave`
- `POST /api/ai/chat`, `GET /api/ai/status`
- `GET /api/health`, `GET /api/system/status`
- Socket.IO: `room:join`, `room:joined`, `room:error`, `participant:joined`, `participant:left`, `offer`, `answer`, `ice-candidate`

## Current prototype limits

- Browser-based projection styling is not physical holography or person segmentation.
- Active room state is in memory and supports two participants.
- Authentication routes are implemented, but the guest-first UI does not yet expose registration/login flows; session endpoints accept guest participants.
- AI provider adapter accepts a simple `{ message }` and `{ reply }` contract; map it to the chosen vendor API before deployment.
- Camera background removal runs in the browser with the MediaPipe selfie segmenter; camera frames are not sent to a segmentation service. The model and WebAssembly runtime are served locally by this app. No media is recorded. Captions, TTS, and device persistence are not yet integrated.
- Production use needs HTTPS, strong secrets, configured TURN, persistent room/session handling, and deployment-specific CORS/rate-limit settings.

## Checks

Build the frontend and API with `npm run build`. No automated test suite is included yet. Manual verification: open the landing/simulator, allow camera permission, adjust effects, start/stop the simulation, and connect two separate browser contexts.
