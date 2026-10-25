import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const app = express();
const server = createServer(app);
const allowedOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
const io = new Server(server, { cors: { origin: allowedOrigin, methods: ["GET", "POST"] } });
const prisma = new PrismaClient();
const jwtSecret = process.env.JWT_SECRET || "local-development-only-change-this-secret";
if (!process.env.JWT_SECRET) console.warn("JWT_SECRET is not set; using a development-only secret.");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

type UserClaims = { sub: string; email: string };
type AuthedRequest = Request & { user?: UserClaims };
type LiveParticipant = { id: string; name: string; joinedAt: string };
type LiveRoom = { roomCode: string; createdAt: number; participants: Map<string, LiveParticipant>; creatorId: string };
const rooms = new Map<string, LiveRoom>();
const activeSockets = new Map<string, { roomCode: string; participant: LiveParticipant }>();

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
function tokenFor(user: { id: string; email: string }) { return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: "12h" }); }
function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } });
  try { req.user = jwt.verify(token, jwtSecret) as UserClaims; next(); }
  catch { return res.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Your session expired. Sign in again." } }); }
}
function makeRoomCode() { return randomBytes(4).toString("hex").toUpperCase(); }
const newRoomSchema = z.object({ displayName: z.string().trim().min(1).max(50).optional() });
const authSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(72), name: z.string().trim().min(1).max(60).optional() });

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "holoconnect-api", time: new Date().toISOString() }));
app.get("/api/system/status", (_req, res) => res.json({ api: "online", database: process.env.DATABASE_URL ? "configured" : "not configured", ai: process.env.AI_PROVIDER_API_KEY ? "provider configured" : "demo mode", turn: process.env.TURN_URL || process.env.NEXT_PUBLIC_TURN_URL ? "configured" : "not configured", mediaRecording: false }));

app.post("/api/auth/register", wrap(async (req, res) => {
  const parsed = authSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email and a password with at least 8 characters." } });
  const { email, password, name } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (existing) return res.status(409).json({ error: { code: "EMAIL_IN_USE", message: "An account with this email already exists." } });
  try { const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), name: name || email.split("@")[0] } }); return res.status(201).json({ user: { id: user.id, email: user.email, name: user.name }, token: tokenFor(user) }); }
  catch { return res.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "Account creation needs a connected PostgreSQL database." } }); }
}));
app.post("/api/auth/login", wrap(async (req, res) => {
  const parsed = authSchema.pick({ email: true, password: true }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email and password." } });
  try { const user = await prisma.user.findUnique({ where: { email: parsed.data.email } }); if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }); return res.json({ user: { id: user.id, email: user.email, name: user.name }, token: tokenFor(user) }); }
  catch { return res.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "Sign in needs a connected PostgreSQL database." } }); }
}));
app.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));
app.get("/api/auth/me", auth, wrap(async (req, res) => { const user = await prisma.user.findUnique({ where: { id: (req as AuthedRequest).user!.sub }, select: { id: true, email: true, name: true } }); if (!user) return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found." } }); return res.json({ user }); }));

app.post("/api/sessions", wrap(async (req, res) => {
  const parsed = newRoomSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid session details." } });
  let roomCode = makeRoomCode(); while (rooms.has(roomCode)) roomCode = makeRoomCode();
  const room: LiveRoom = { roomCode, createdAt: Date.now(), creatorId: randomUUID(), participants: new Map() }; rooms.set(roomCode, room);
  res.status(201).json({ roomCode, status: "active", createdAt: new Date(room.createdAt).toISOString() });
}));
app.get("/api/sessions", auth, (_req, res) => res.json({ sessions: [] }));
app.get("/api/sessions/:id", auth, (req, res) => { const room = rooms.get(String(req.params.id).toUpperCase()); if (!room) return res.status(404).json({ error: { code: "ROOM_NOT_FOUND", message: "This room is no longer available." } }); return res.json({ roomCode: room.roomCode, participants: [...room.participants.values()] }); });
app.post("/api/sessions/:id/join", (req, res) => { const room = rooms.get(String(req.params.id).toUpperCase()); if (!room) return res.status(404).json({ error: { code: "ROOM_NOT_FOUND", message: "This room is no longer available." } }); if (room.participants.size >= 2) return res.status(409).json({ error: { code: "ROOM_FULL", message: "This prototype supports two participants per room." } }); res.json({ roomCode: room.roomCode, status: "available" }); });
app.post("/api/sessions/:id/leave", (req, res) => { const room = rooms.get(String(req.params.id).toUpperCase()); if (room) rooms.delete(room.roomCode); res.json({ ok: true }); });

app.post("/api/ai/chat", wrap(async (req, res) => {
  const parsed = z.object({ message: z.string().trim().min(1).max(2000) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a message." } });
  if (process.env.AI_PROVIDER_API_KEY && process.env.AI_PROVIDER_URL) {
    try { const response = await fetch(process.env.AI_PROVIDER_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_PROVIDER_API_KEY}` }, body: JSON.stringify({ message: parsed.data.message }) }); if (response.ok) { const data = await response.json() as { reply?: string }; if (data.reply) return res.json({ reply: data.reply, mode: "provider" }); } }
    catch { /* Fall through to a labeled local response. */ }
  }
  const q = parsed.data.message.toLowerCase(); let reply = "This prototype uses a local demo assistant, so it has not sent your message to an AI provider. I can explain the simulator, session setup, or the technology stack.";
  if (q.includes("hologram") || q.includes("display")) reply = "The receiver view layers a live video feed with perspective, cyan edge light, scan lines, a depth grid, and a projection base. It is a browser-based visual simulation, not an optical hologram.";
  else if (q.includes("connect") || q.includes("room")) reply = "Create a room, then share its link or code with another browser. Both participants need camera permission. WebRTC attempts a direct media connection; some networks also need a TURN relay.";
  else if (q.includes("camera") || q.includes("permission")) reply = "Use the Enable camera control and allow browser access. Camera media stays in this browser until a session is joined, and the app does not record it.";
  else if (q.includes("5g") || q.includes("latency")) reply = "The project is 5G-ready in its architecture, but it does not guarantee a 5G path. Network quality and latency are reported only when measured from a real peer connection.";
  res.json({ reply, mode: "demo", label: "Demo assistant · no external AI provider called" });
}));
app.get("/api/ai/status", (_req, res) => res.json({ available: true, mode: process.env.AI_PROVIDER_API_KEY && process.env.AI_PROVIDER_URL ? "provider" : "demo", label: process.env.AI_PROVIDER_API_KEY ? "Provider configured" : "Demo assistant · no external model configured" }));

io.on("connection", (socket: Socket) => {
  socket.on("room:join", ({ roomCode, displayName }: { roomCode?: string; displayName?: string }) => {
    const code = (roomCode || "").trim().toUpperCase(); const room = rooms.get(code);
    if (!room) { socket.emit("room:error", { message: "Room not found · create a new session or check the code" }); return; }
    if (room.participants.size >= 2) { socket.emit("room:error", { message: "This room already has two participants" }); return; }
    const participant: LiveParticipant = { id: socket.id, name: (displayName || "Guest").slice(0, 50), joinedAt: new Date().toISOString() };
    const isInitiator = room.participants.size === 0; room.participants.set(socket.id, participant); activeSockets.set(socket.id, { roomCode: code, participant }); socket.join(code);
    socket.emit("room:joined", { roomCode: code, participants: [...room.participants.values()].filter(p => p.id !== socket.id), isInitiator });
    socket.to(code).emit("participant:joined", participant);
  });
  for (const event of ["offer", "answer", "ice-candidate"] as const) socket.on(event, (payload: { to?: string; description?: unknown; candidate?: unknown }) => {
    const source = activeSockets.get(socket.id); if (!source || !payload.to || !source.roomCode) return;
    const room = rooms.get(source.roomCode); if (!room?.participants.has(payload.to)) return;
    io.to(payload.to).emit(event, { from: socket.id, description: payload.description, candidate: payload.candidate });
  });
  socket.on("disconnect", () => { const source = activeSockets.get(socket.id); if (!source) return; const room = rooms.get(source.roomCode); room?.participants.delete(socket.id); socket.to(source.roomCode).emit("participant:left", { participantId: socket.id }); activeSockets.delete(socket.id); if (!room?.participants.size) rooms.delete(source.roomCode); });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => { console.error("API error:", err); res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }); });
const port = Number(process.env.API_PORT || 4000);
server.listen(port, () => console.log(`HoloConnect API and signaling listening on http://localhost:${port}`));
process.on("SIGINT", () => { void prisma.$disconnect(); server.close(); });

