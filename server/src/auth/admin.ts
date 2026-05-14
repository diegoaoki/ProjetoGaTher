import { Request, Response, NextFunction } from "express";

/**
 * Define quem é admin via env var ADMIN_EMAILS (lista CSV).
 * Exemplo: ADMIN_EMAILS="diego.furman@grupoavenida.com.br,fulano@dom.br"
 *
 * Decisão: usar env em vez de coluna no DB pra não precisar de migração
 * nem de caminho manual pra "eleger" o primeiro admin.
 */

function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.toLowerCase().trim());
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Não autenticado" });
  if (!isAdminEmail(req.auth.email)) {
    return res.status(403).json({ error: "Acesso negado" });
  }
  next();
}
