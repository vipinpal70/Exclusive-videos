import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { queryOne } from "./db";
import { can, parsePermissions, type AdminUser, type Permission } from "./permissions";
import { ADMIN_COOKIE, USER_COOKIE, verifyToken, type AdminClaims, type UserClaims } from "./session";

export async function getAdmin() {
  const jar = await cookies();
  return verifyToken<AdminClaims>(jar.get(ADMIN_COOKIE)?.value, "admin");
}

/** Current admin with permissions loaded fresh from the DB, so changes and deletions apply immediately. */
export async function getAdminUser(): Promise<AdminUser | null> {
  const claims = await getAdmin();
  if (!claims) return null;
  const row = await queryOne<{ id: number; username: string; is_super: number; permissions: string | null }>(
    "SELECT id, username, is_super, permissions FROM admins WHERE id = ?",
    [claims.aid]
  );
  if (!row) return null;
  return { id: row.id, username: row.username, isSuper: !!row.is_super, permissions: parsePermissions(row.permissions) };
}

export async function getUser() {
  const jar = await cookies();
  return verifyToken<UserClaims>(jar.get(USER_COOKIE)?.value, "user");
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/**
 * Wraps an admin API handler: rejects unauthenticated requests, enforces an optional permission
 * ("super" = super admins only) and turns thrown errors into JSON.
 */
export function adminRoute<C>(handler: (req: Request, ctx: C, admin: AdminUser) => Promise<Response>, required?: Permission | "super") {
  return async (req: Request, ctx: C) => {
    try {
      const admin = await getAdminUser();
      if (!admin) return fail("Unauthorized", 401);
      if (required === "super" ? !admin.isSuper : required && !can(admin, required)) {
        return fail("You don't have permission to do this.", 403);
      }
      return await handler(req, ctx, admin);
    } catch (e) {
      console.error(e);
      return fail(e instanceof Error ? e.message : "Server error", 500);
    }
  };
}

export function publicRoute<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(e);
      return fail(e instanceof Error ? e.message : "Server error", 500);
    }
  };
}

export function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
