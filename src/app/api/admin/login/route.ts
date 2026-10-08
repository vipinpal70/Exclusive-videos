import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { fail, publicRoute } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { ADMIN_COOKIE, ADMIN_REMEMBER_TTL, ADMIN_SESSION_TTL, cookieOptions, signToken } from "@/lib/session";

const attempts = new Map<string, { n: number; until: number }>();

export const POST = publicRoute(async (req) => {
  const { username, password, remember } = await req.json().catch(() => ({}));
  const u = String(username ?? "").trim();
  const key = u.toLowerCase();

  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return fail("Too many failed attempts. Try again in 15 minutes.", 429);

  const admin = await queryOne<{ id: number; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM admins WHERE username = ?",
    [u]
  );
  const valid = admin ? await bcrypt.compare(String(password ?? ""), admin.password_hash) : false;
  if (!admin || !valid) {
    const cur = a && a.until > Date.now() ? a : { n: 0, until: 0 };
    attempts.set(key, { n: cur.n + 1, until: Date.now() + 15 * 60_000 });
    return fail("Invalid username or password.", 401);
  }
  attempts.delete(key);
  await execute("UPDATE admins SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [admin.id]);

  const res = NextResponse.json({ ok: true });
  const rm = remember === true;
  const token = await signToken({ aid: admin.id, username: admin.username, rm }, rm ? ADMIN_REMEMBER_TTL : ADMIN_SESSION_TTL, "admin");
  res.cookies.set(ADMIN_COOKIE, token, cookieOptions(rm ? ADMIN_REMEMBER_TTL : undefined));
  return res;
});
