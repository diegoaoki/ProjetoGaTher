import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  sub: string;       // user.id (ou "visitor:<uuid>")
  email: string;     // "" pra visitante
  role?: "user" | "visitor";
  name?: string;     // só pra visitante (não tem profile no DB)
}

const DEFAULT_EXPIRY = "7d";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET não configurado (mínimo 16 chars). Gere com: openssl rand -hex 32");
  }
  return secret;
}

export function signAuthToken(payload: AuthTokenPayload, expiresIn: string = DEFAULT_EXPIRY): string {
  return jwt.sign(payload, getSecret(), { expiresIn } as jwt.SignOptions);
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === "string" || !decoded.sub) {
    throw new Error("Token inválido");
  }
  const role = (decoded as any).role === "visitor" ? "visitor" : "user";
  // Usuário normal tem email; visitante pode não ter.
  if (role === "user" && !(decoded as any).email) {
    throw new Error("Token inválido");
  }
  return {
    sub: String(decoded.sub),
    email: String((decoded as any).email || ""),
    role,
    name: (decoded as any).name ? String((decoded as any).name) : undefined,
  };
}
