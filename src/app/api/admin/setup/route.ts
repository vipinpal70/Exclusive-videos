import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { fail, json, publicRoute } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { ADMIN_COOKIE, ADMIN_SESSION_TTL, cookieOptions, signToken } from "@/lib/session";

async function hasAdmin() {
  const row = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM admins");
  return Number(row?.c ?? 0) > 0;
}

export const GET = publicRoute(async () => json({ ok: true, needsSetup: !(await hasAdmin()) }));

export const POST = publicRoute(async (req) => {
  if (await hasAdmin()) return fail("Setup has already been completed.", 403);
  const { username, password } = await req.json().catch(() => ({}));
  const u = String(username ?? "").trim();
  if (!/^[a-zA-Z0-9_.@-]{3,100}$/.test(u)) return fail("Username must be 3+ characters (letters, numbers, _ . @ -).");
  if (String(password ?? "").length < 8) return fail("Password must be at least 8 characters.");

  const hash = await bcrypt.hash(String(password), 12);
  const r = await execute("INSERT INTO admins (username, password_hash, is_super, last_login_at) VALUES (?, ?, 1, UTC_TIMESTAMP())", [u, hash]);
  const res = NextResponse.json({ ok: true });
  // First sign-in after setup is not remembered; it stays in this tab like any login without "Remember me".
  res.cookies.set(ADMIN_COOKIE, await signToken({ aid: r.insertId, username: u, rm: false }, ADMIN_SESSION_TTL, "admin"), cookieOptions());
  return res;
});
