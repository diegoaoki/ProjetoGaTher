import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { users, profiles } from "../db/schema";
import { hashPassword, verifyPassword } from "./password";
import { signAuthToken } from "./jwt";
import { requireAuth } from "./middleware";
import { isAdminEmail, isEnvAdmin, requireAdmin } from "./admin";
import { setExtraAdmin } from "../adminStore";
import { isUserOnline } from "../presence";
import { getPool } from "../db/client";
import { randomUUID } from "crypto";

// Códigos de convidado em memória (1 uso, TTL curto). Reinício do server
// limpa — aceitável (códigos são efêmeros por natureza).
const visitorCodes = new Map<string, { exp: number; used: boolean; by: string }>();
const VISITOR_CODE_TTL_MS = 30 * 60 * 1000; // 30 min

function genVisitorCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem chars ambíguos
  let c = "";
  for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const registerSchema = z.object({
  email: z.string().email().max(256).toLowerCase().trim(),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(24),
  bodyColor: z.string().regex(HEX_COLOR).optional(),
  hairColor: z.string().regex(HEX_COLOR).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(256).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

const CHARACTER_IDS = ["adam", "alex", "amelia", "bob"] as const;

const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(24).optional(),
  bodyColor: z.string().regex(HEX_COLOR).optional(),
  hairColor: z.string().regex(HEX_COLOR).optional(),
  characterId: z.enum(CHARACTER_IDS).optional(),
  // Avatar modular: JSON {body,hair,outfit,hat} (validação leve de tamanho;
  // conteúdo é resolvido no cliente com fallback).
  appearance: z.string().max(300).optional(),
  // Foto de perfil (data URL pequeno p/ mini-mapa) ou "" pra remover.
  photo: z.string().max(60000).optional(),
});

// Rate limits separados: registro/login mais restrito (anti-bruteforce),
// /me e /profile mais soltos pois exigem JWT válido.
const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15min
  limit: 20,                 // 20 tentativas por IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." },
});

const authReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export function createAuthRouter() {
  const router = Router();

  router.post("/auth/register", authStrictLimiter, async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const { email, password, displayName, bodyColor, hairColor } = parsed.data;

    try {
      const db = getDb();

      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "Email já cadastrado" });
      }

      const passwordHash = await hashPassword(password);

      const [user] = await db
        .insert(users)
        .values({ email, passwordHash })
        .returning({ id: users.id, email: users.email });

      const [profile] = await db
        .insert(profiles)
        .values({
          userId: user.id,
          displayName,
          ...(bodyColor ? { bodyColor } : {}),
          ...(hairColor ? { hairColor } : {}),
        })
        .returning();

      const token = signAuthToken({ sub: user.id, email: user.email });
      return res.status(201).json({
        token,
        user: { id: user.id, email: user.email, isAdmin: isAdminEmail(user.email) },
        profile,
      });
    } catch (err: any) {
      console.error("[/auth/register] erro:", err);
      return res.status(500).json({ error: "Falha ao registrar" });
    }
  });

  router.post("/auth/login", authStrictLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const { email, password } = parsed.data;

    try {
      const db = getDb();

      const [user] = await db
        .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      // Mensagem genérica pra não vazar quais emails existem
      if (!user) return res.status(401).json({ error: "Credenciais inválidas" });

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });

      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);

      const token = signAuthToken({ sub: user.id, email: user.email });
      return res.json({
        token,
        user: { id: user.id, email: user.email, isAdmin: isAdminEmail(user.email) },
        profile,
      });
    } catch (err: any) {
      console.error("[/auth/login] erro:", err);
      return res.status(500).json({ error: "Falha ao autenticar" });
    }
  });

  router.get("/auth/me", authReadLimiter, requireAuth, async (req: Request, res: Response) => {
    try {
      // Visitante não tem linha no Postgres — devolve do próprio token
      // (senão um refresh deslogaria e o código de uso único já foi gasto).
      if (req.auth?.role === "visitor") {
        const id = req.auth.sub;
        const name = req.auth.name || "Visitante";
        return res.json({
          user: { id, email: "", isAdmin: false, role: "visitor" },
          profile: {
            userId: id,
            displayName: name,
            bodyColor: "#4ade80",
            hairColor: "#3b2c20",
            characterId: null,
            appearance: null,
            photo: null,
          },
        });
      }

      const db = getDb();
      const userId = req.auth!.sub;

      const [user] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
      return res.json({
        user: { id: user.id, email: user.email, isAdmin: isAdminEmail(user.email) },
        profile,
      });
    } catch (err: any) {
      console.error("[/auth/me] erro:", err);
      return res.status(500).json({ error: "Falha ao buscar usuário" });
    }
  });

  // ============================================================
  //  Modo visitante: qualquer logado gera um código de uso único;
  //  o visitante entra com nome + código OU senha fixa (env).
  // ============================================================

  router.post("/visitor/code", authReadLimiter, requireAuth, (req: Request, res: Response) => {
    if (req.auth?.role === "visitor") {
      return res.status(403).json({ error: "Visitantes não geram códigos" });
    }
    // Limpa expirados (housekeeping barato)
    const now = Date.now();
    for (const [k, v] of visitorCodes) if (v.exp < now) visitorCodes.delete(k);

    let code = genVisitorCode();
    while (visitorCodes.has(code)) code = genVisitorCode();
    const exp = now + VISITOR_CODE_TTL_MS;
    visitorCodes.set(code, { exp, used: false, by: req.auth!.sub });
    return res.json({ code, expiresAt: exp });
  });

  const visitorLoginSchema = z.object({
    name: z.string().min(1).max(24).trim(),
    code: z.string().trim().toUpperCase().optional(),
    password: z.string().optional(),
  });

  router.post("/visitor/login", authStrictLimiter, (req: Request, res: Response) => {
    const parsed = visitorLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Nome obrigatório (até 24 chars)" });
    }
    const { name, code, password } = parsed.data;

    let ok = false;
    let host: string | undefined;
    if (code) {
      const entry = visitorCodes.get(code);
      if (entry && !entry.used && entry.exp >= Date.now()) {
        entry.used = true;
        host = entry.by; // quem gerou o código é o host do visitante
        ok = true;
      } else {
        return res.status(401).json({ error: "Código inválido ou expirado" });
      }
    } else if (password) {
      const vp = process.env.VISITOR_PASSWORD;
      if (vp && password === vp) ok = true;
      else return res.status(401).json({ error: "Senha de visitante incorreta" });
    } else {
      return res.status(400).json({ error: "Informe um código ou a senha de visitante" });
    }
    if (!ok) return res.status(401).json({ error: "Acesso negado" });

    const id = `visitor:${randomUUID()}`;
    const token = signAuthToken(
      { sub: id, email: "", role: "visitor", name, host },
      "12h"
    );
    return res.json({
      token,
      user: { id, email: "", isAdmin: false, role: "visitor" },
      profile: {
        userId: id,
        displayName: name,
        bodyColor: "#4ade80",
        hairColor: "#3b2c20",
        characterId: null,
      },
    });
  });

  // ============================================================
  //  Editor de mapa: override de mobília + paredes (1 linha em app_meta).
  //  GET é público-autenticado (todo cliente carrega no boot);
  //  PUT é só admin.
  // ============================================================
  const MAP_META_KEY = "map_layout";

  router.get("/map", authReadLimiter, requireAuth, async (_req: Request, res: Response) => {
    try {
      const pool = getPool();
      const r = await pool.query(`SELECT value FROM app_meta WHERE key = $1`, [MAP_META_KEY]);
      const raw = r.rows[0]?.value;
      if (!raw) return res.json({ map: null });
      let map: any = null;
      try { map = JSON.parse(raw); } catch { map = null; }
      return res.json({ map });
    } catch (err: any) {
      console.error("[/map GET] erro:", err);
      return res.status(500).json({ error: "Falha ao carregar o mapa" });
    }
  });

  router.put("/map", authReadLimiter, requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      // Validação básica de forma e tamanho (evita lixo/abuso).
      const furniture = Array.isArray(body?.furniture) ? body.furniture : [];
      const walls = Array.isArray(body?.walls) ? body.walls : [];
      if (furniture.length > 2000 || walls.length > 2000) {
        return res.status(400).json({ error: "Layout grande demais" });
      }
      const json = JSON.stringify({ furniture, walls });
      if (json.length > 1_000_000) {
        return res.status(400).json({ error: "Layout grande demais" });
      }
      const pool = getPool();
      await pool.query(
        `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [MAP_META_KEY, json]
      );
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[/map PUT] erro:", err);
      return res.status(500).json({ error: "Falha ao salvar o mapa" });
    }
  });

  // Apaga o override do editor → volta pro layout padrão do código
  // (inclui mudanças novas de default, ex: Copa nova). Admin-only.
  router.delete("/map", authReadLimiter, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const pool = getPool();
      await pool.query(`DELETE FROM app_meta WHERE key = $1`, [MAP_META_KEY]);
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[/map DELETE] erro:", err);
      return res.status(500).json({ error: "Falha ao restaurar o mapa" });
    }
  });

  // Diretório de TODOS os usuários cadastrados (autenticado, não-admin).
  // Usado pela sidebar pra mostrar online + offline. Não expõe email.
  router.get("/users", authReadLimiter, requireAuth, async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = await db
        .select({ id: users.id, createdAt: users.createdAt })
        .from(users)
        .orderBy(users.createdAt);

      const profileRows = await db.select().from(profiles);
      const profileById = new Map(profileRows.map((p) => [p.userId, p]));

      const list = rows.map((u) => {
        const prof = profileById.get(u.id);
        return {
          id: u.id,
          displayName: prof?.displayName ?? "(sem nome)",
          bodyColor: prof?.bodyColor ?? "#4ade80",
          hairColor: prof?.hairColor ?? "#3b2c20",
          characterId: prof?.characterId ?? null,
          isOnline: isUserOnline(u.id),
        };
      });
      return res.json({ users: list });
    } catch (err: any) {
      console.error("[/users GET] erro:", err);
      return res.status(500).json({ error: "Falha ao listar usuários" });
    }
  });

  // ============================================================
  //  Endpoints admin (montados aqui pra reusar limiter + middleware)
  //  Lista de admins definida pela env ADMIN_EMAILS.
  // ============================================================

  const resetPasswordSchema = z.object({
    newPassword: z.string().min(8).max(128),
  });

  const changeMyPasswordSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  });

  // Usuário troca a PRÓPRIA senha (qualquer logado, não precisa ser
  // admin). Exige a senha atual. Visitante não tem senha → bloqueia.
  router.patch(
    "/auth/password",
    authReadLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      if (req.auth?.role === "visitor") {
        return res.status(400).json({ error: "Visitante não tem senha" });
      }
      const parsed = changeMyPasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      try {
        const db = getDb();
        const userId = req.auth!.sub;
        const [user] = await db
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
        const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
        if (!ok) return res.status(400).json({ error: "Senha atual incorreta" });
        const passwordHash = await hashPassword(parsed.data.newPassword);
        await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
        return res.json({ ok: true });
      } catch (err: any) {
        console.error("[/auth/password] erro:", err);
        return res.status(500).json({ error: "Falha ao trocar a senha" });
      }
    }
  );

  router.get("/admin/users", authReadLimiter, requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(users.createdAt);

      // Enriquece com displayName do profile, em uma única query separada
      const profileRows = await db.select().from(profiles);
      const profileById = new Map(profileRows.map((p) => [p.userId, p]));

      const list = rows.map((u) => ({
        ...u,
        isAdmin: isAdminEmail(u.email),
        envAdmin: isEnvAdmin(u.email), // admin por env não dá pra remover na UI
        displayName: profileById.get(u.id)?.displayName ?? null,
      }));
      return res.json({ users: list });
    } catch (err: any) {
      console.error("[/admin/users GET] erro:", err);
      return res.status(500).json({ error: "Falha ao listar usuários" });
    }
  });

  router.patch(
    "/admin/users/:id/password",
    authReadLimiter,
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const targetId = req.params.id;
      try {
        const db = getDb();
        const passwordHash = await hashPassword(parsed.data.newPassword);
        const [updated] = await db
          .update(users)
          .set({ passwordHash })
          .where(eq(users.id, targetId))
          .returning({ id: users.id, email: users.email });

        if (!updated) return res.status(404).json({ error: "Usuário não encontrado" });
        console.log(`[admin] ${req.auth!.email} resetou senha de ${updated.email}`);
        return res.json({ ok: true });
      } catch (err: any) {
        console.error("[/admin/users/:id/password] erro:", err);
        return res.status(500).json({ error: "Falha ao resetar senha" });
      }
    }
  );

  // Promove/remove admin (só admin faz; persiste em app_meta).
  router.patch(
    "/admin/users/:id/admin",
    authReadLimiter,
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      const make = !!req.body?.make;
      const targetId = String(req.params.id || "");
      try {
        const db = getDb();
        const [u] = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.id, targetId));
        if (!u) return res.status(404).json({ error: "Usuário não encontrado" });

        if (!make && isEnvAdmin(u.email)) {
          return res.status(400).json({
            error: "Esse admin é definido por ADMIN_EMAILS (env) — remova de lá, não dá pela UI.",
          });
        }
        if (!make && u.email.toLowerCase() === (req.auth!.email || "").toLowerCase()) {
          return res.status(400).json({ error: "Você não pode remover o próprio admin (evita travar o sistema)." });
        }

        await setExtraAdmin(u.email, make);
        console.log(`[admin] ${req.auth!.email} ${make ? "promoveu" : "removeu"} admin de ${u.email}`);
        return res.json({ ok: true });
      } catch (err: any) {
        console.error("[/admin/users/:id/admin] erro:", err);
        return res.status(500).json({ error: "Falha ao atualizar admin" });
      }
    }
  );

  router.delete(
    "/admin/users/:id",
    authReadLimiter,
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      const targetId = req.params.id;
      // Bloqueia auto-delete (admin se trancando do sistema).
      if (targetId === req.auth!.sub) {
        return res.status(400).json({ error: "Você não pode apagar a própria conta" });
      }
      try {
        const db = getDb();
        // profiles tem FK com ON DELETE CASCADE — apaga junto.
        const [deleted] = await db
          .delete(users)
          .where(eq(users.id, targetId))
          .returning({ id: users.id, email: users.email });

        if (!deleted) return res.status(404).json({ error: "Usuário não encontrado" });
        console.log(`[admin] ${req.auth!.email} apagou ${deleted.email}`);
        return res.json({ ok: true });
      } catch (err: any) {
        console.error("[/admin/users/:id DELETE] erro:", err);
        return res.status(500).json({ error: "Falha ao apagar usuário" });
      }
    }
  );

  router.patch("/profile", authReadLimiter, requireAuth, async (req: Request, res: Response) => {
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nenhum campo pra atualizar" });
    }

    try {
      const db = getDb();
      const userId = req.auth!.sub;

      const [profile] = await db
        .update(profiles)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(profiles.userId, userId))
        .returning();

      if (!profile) return res.status(404).json({ error: "Perfil não encontrado" });
      return res.json({ profile });
    } catch (err: any) {
      console.error("[/profile] erro:", err);
      return res.status(500).json({ error: "Falha ao atualizar perfil" });
    }
  });

  return router;
}
