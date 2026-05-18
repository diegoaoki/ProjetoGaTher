import { Request, Response, NextFunction } from "express";
import { isExtraAdmin } from "../adminStore";

/**
 * Admin = email em ADMIN_EMAILS (env, "bootstrap") OU promovido pela
 * UI (adminStore, persistido em app_meta). Env continua sendo o jeito
 * de eleger o primeiro admin sem migração; a UI promove os demais.
 */

function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Admin definido por env (ADMIN_EMAILS) — não removível pela UI. */
export function isEnvAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.toLowerCase().trim());
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return isEnvAdmin(email) || isExtraAdmin(email);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Não autenticado" });
  if (!isAdminEmail(req.auth.email)) {
    return res.status(403).json({ error: "Acesso negado" });
  }
  next();
}
