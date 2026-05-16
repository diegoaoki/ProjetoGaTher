import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { users, profiles } from "../db/schema";
import { hashPassword, verifyPassword } from "./password";
import { signAuthToken } from "./jwt";
import { requireAuth } from "./middleware";
import { isAdminEmail, requireAdmin } from "./admin";
import { isUserOnline } from "../presence";

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
