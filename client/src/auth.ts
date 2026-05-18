/**
 * Helper de autenticação no client.
 * Centraliza fetch dos endpoints /auth/* e a gestão do JWT no localStorage.
 */

const TOKEN_KEY = "virtual-office-jwt-v1";

export interface AuthUser {
  id: string;
  email: string;
  isAdmin?: boolean;
  role?: "user" | "visitor";
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  /** Admin via env ADMIN_EMAILS — não dá pra remover pela UI. */
  envAdmin?: boolean;
  createdAt: string;
}

export interface AuthProfile {
  userId: string;
  displayName: string;
  bodyColor: string;
  hairColor: string;
  characterId?: string | null;
  updatedAt?: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  profile: AuthProfile;
}

/** Usuário no diretório (sidebar) — todos cadastrados, com flag de online. */
export interface DirectoryUser {
  id: string;
  displayName: string;
  bodyColor: string;
  hairColor: string;
  characterId?: string | null;
  isOnline: boolean;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function parseError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    return data?.error || `Erro ${resp.status}`;
  } catch {
    return `Erro ${resp.status}`;
  }
}

export async function register(
  httpUrl: string,
  body: { email: string; password: string; displayName: string; bodyColor?: string; hairColor?: string }
): Promise<AuthSession> {
  const resp = await fetch(httpUrl + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  storeToken(data.token);
  return data;
}

export async function login(
  httpUrl: string,
  body: { email: string; password: string }
): Promise<AuthSession> {
  const resp = await fetch(httpUrl + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  storeToken(data.token);
  return data;
}

/** Entra como visitante (sem conta) via código de uso único OU senha fixa. */
export async function loginVisitor(
  httpUrl: string,
  body: { name: string; code?: string; password?: string }
): Promise<AuthSession> {
  const resp = await fetch(httpUrl + "/visitor/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  storeToken(data.token);
  return data;
}

/** Usuário logado gera um código de convidado (uso único, TTL no server). */
export async function createVisitorCode(
  httpUrl: string,
  token: string
): Promise<{ code: string; expiresAt: number }> {
  const resp = await fetch(httpUrl + "/visitor/code", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  return resp.json();
}

export async function fetchMe(httpUrl: string, token: string): Promise<{ user: AuthUser; profile: AuthProfile }> {
  const resp = await fetch(httpUrl + "/auth/me", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  return resp.json();
}

export async function updateProfile(
  httpUrl: string,
  token: string,
  patch: { displayName?: string; bodyColor?: string; hairColor?: string; characterId?: string }
): Promise<AuthProfile> {
  const resp = await fetch(httpUrl + "/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return data.profile;
}

/** Diretório completo (online + offline). Não precisa ser admin. */
export async function listAllUsers(httpUrl: string, token: string): Promise<DirectoryUser[]> {
  const resp = await fetch(httpUrl + "/users", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return data.users;
}

/** Override de mapa (mobília + paredes) — substitui as camadas editáveis. */
export interface MapOverride {
  furniture: any[];
  walls: any[];
}

export async function fetchMapLayout(httpUrl: string, token: string): Promise<MapOverride | null> {
  const resp = await fetch(httpUrl + "/map", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store", // sempre pega o mapa salvo mais recente
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return data.map ?? null;
}

export async function saveMapLayout(
  httpUrl: string,
  token: string,
  map: MapOverride
): Promise<void> {
  const resp = await fetch(httpUrl + "/map", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(map),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}

/** Apaga o override salvo → volta pro layout padrão do código. Admin-only. */
export async function resetMapLayout(httpUrl: string, token: string): Promise<void> {
  const resp = await fetch(httpUrl + "/map", {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}

// ============ Admin ============

export async function listUsers(httpUrl: string, token: string): Promise<AdminUser[]> {
  const resp = await fetch(httpUrl + "/admin/users", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  const data = await resp.json();
  return data.users;
}

export async function resetUserPassword(
  httpUrl: string,
  token: string,
  userId: string,
  newPassword: string
): Promise<void> {
  const resp = await fetch(httpUrl + `/admin/users/${userId}/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ newPassword }),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}

export async function deleteUser(httpUrl: string, token: string, userId: string): Promise<void> {
  const resp = await fetch(httpUrl + `/admin/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}

/** Promove (make=true) ou remove (make=false) admin de um usuário. */
export async function setUserAdmin(
  httpUrl: string,
  token: string,
  userId: string,
  make: boolean
): Promise<void> {
  const resp = await fetch(httpUrl + `/admin/users/${userId}/admin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ make }),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}
