import { Request, Response, NextFunction } from "express";
import { verifyAuthToken, AuthTokenPayload } from "./jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

/**
 * Extrai Bearer token do header Authorization. Não rejeita se faltar —
 * só preenche req.auth quando presente e válido. Use junto com requireAuth.
 */
export function extractAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next();
  const token = header.slice(7).trim();
  if (!token) return next();
  try {
    req.auth = verifyAuthToken(token);
  } catch {
    // Token inválido ou expirado — ignora; requireAuth devolve 401 se rota exigir
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}
