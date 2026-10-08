import { SignJWT, jwtVerify } from "jose";

export const ADMIN_COOKIE = "ev_admin";
export const USER_COOKIE = "ev_user";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET env var is missing or too short");
  return new TextEncoder().encode(s);
}

export interface AdminClaims {
  aid: number;
  username: string;
  rm?: boolean; // "remember me": persistent cookie; otherwise the login is limited to one browser tab
}

export const ADMIN_REMEMBER_TTL = 60 * 60 * 24 * 30;
export const ADMIN_SESSION_TTL = 60 * 60 * 12;

export interface UserClaims {
  mid: number; // member id
  email: string;
  ev: boolean; // email verified (or OTP disabled)
}

export async function signToken(payload: object, maxAgeSeconds: number, audience: string) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(audience)
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(secret());
}

export async function verifyToken<T>(token: string | undefined, audience: string): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience });
    return payload as T;
  } catch {
    return null;
  }
}

/** Omit maxAge for a session cookie that the browser drops when it closes. */
export const cookieOptions = (maxAge?: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
