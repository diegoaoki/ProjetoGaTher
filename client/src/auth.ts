/**
 * Helper de autenticação no client.
 * Centraliza fetch dos endpoints /auth/* e a gestão do JWT no localStorage.
 */

const TOKEN_KEY = "virtual-office-jwt-v1";

export interface AuthUser {
  id: string;
  email: string;
  isAdmin?: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
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
