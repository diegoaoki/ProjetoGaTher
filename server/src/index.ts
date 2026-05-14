import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import basicAuth from "express-basic-auth";
import { OfficeRoom } from "./OfficeRoom";
import { createTokenRouter } from "./tokenRouter";
import { createAuthRouter } from "./auth/router";
import { extractAuth } from "./auth/middleware";
import { initDb } from "./db/init";

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

// extractAuth roda em TODAS as rotas — preenche req.auth quando tem JWT válido.
// requireAuth (nas rotas específicas) é que devolve 401 quando exigido.
app.use(extractAuth);

app.get("/", (_req, res) => {
  res.json({
    service: "virtual-office-server",
    status: "ok",
    livekit: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    db: !!process.env.DATABASE_URL,
    ts: Date.now(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use("/", createAuthRouter());
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

async function bootstrap() {
  // Inicializa schema do Postgres (idempotente). Falha o boot se DATABASE_URL não estiver setada.
  try {
    await initDb();
  } catch (err: any) {
    console.error("[boot] falha ao inicializar DB:", err?.message || err);
    console.error("[boot] o server NÃO vai aceitar conexões sem DB. Configure DATABASE_URL.");
    process.exit(1);
  }

  await gameServer.listen(PORT, "0.0.0.0");
  console.log(`✓ Servidor Colyseus rodando na porta ${PORT}`);
  console.log(
    `✓ Origens permitidas:`,
    allowedOrigins.length > 0 ? allowedOrigins : "(qualquer — dev mode)"
  );
  console.log(
    `✓ LiveKit:`,
    process.env.LIVEKIT_API_KEY ? "configurado" : "NÃO configurado (adicione LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)"
  );
  console.log(`✓ JWT_SECRET:`, process.env.JWT_SECRET ? "configurado" : "NÃO configurado");
  if (process.env.MONITOR_USER) {
    console.log(`✓ Dashboard /colyseus protegido por basic auth`);
  }
}

bootstrap();
