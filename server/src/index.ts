import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import basicAuth from "express-basic-auth";
import { OfficeRoom } from "./OfficeRoom";
import { createTokenRouter } from "./tokenRouter";

const PORT = Number(process.env.PORT || 2567);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "virtual-office-server",
    status: "ok",
    livekit: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    ts: Date.now(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Endpoint pra gerar tokens do LiveKit
app.use("/", createTokenRouter());

// Dashboard /colyseus protegido
if (process.env.MONITOR_USER && process.env.MONITOR_PASS) {
  app.use(
    "/colyseus",
    basicAuth({
      users: { [process.env.MONITOR_USER]: process.env.MONITOR_PASS },
      challenge: true,
    }),
    monitor()
  );
} else if (process.env.NODE_ENV !== "production") {
  app.use("/colyseus", monitor());
}

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("office", OfficeRoom);

gameServer.listen(PORT, "0.0.0.0").then(() => {
  console.log(`✓ Servidor Colyseus rodando na porta ${PORT}`);
  console.log(
    `✓ Origens permitidas:`,
    allowedOrigins.length > 0 ? allowedOrigins : "(qualquer — dev mode)"
  );
  console.log(
    `✓ LiveKit:`,
    process.env.LIVEKIT_API_KEY ? "configurado" : "NÃO configurado (adicione LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)"
  );
  if (process.env.MONITOR_USER) {
    console.log(`✓ Dashboard /colyseus protegido por basic auth`);
  }
});
