import bcrypt from "bcryptjs";
import { adminRoute, fail, json } from "@/lib/auth";
import { execute, query, queryOne } from "@/lib/db";
import { ALL_PERMISSIONS, parsePermissions } from "@/lib/permissions";

const USERNAME_RE = /^[a-zA-Z0-9_.@-]{3,100}$/;

/** Every admin can see who has access; only super admins can change it. */
export const GET = adminRoute(async (_req, _ctx, me) => {
  const rows = await query<{ id: number; username: string; is_super: number; permissions: string | null; last_login_at: string | null; created_at: string }>(
    "SELECT id, username, is_super, permissions, last_login_at, created_at FROM admins ORDER BY is_super DESC, id ASC"
  );
  const admins = rows.map((r) => ({
    id: r.id,
    username: r.username,
    isSuper: !!r.is_super,
    permissions: r.is_super ? ALL_PERMISSIONS : parsePermissions(r.permissions),
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  }));
  return json({ ok: true, me, admins });
});

export const POST = adminRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? "").trim();
  if (!USERNAME_RE.test(username)) return fail("Username must be 3+ characters (letters, numbers, _ . @ -).");
  if (String(body.password ?? "").length < 8) return fail("Password must be at least 8 characters.");
  if (await queryOne("SELECT id FROM admins WHERE username = ?", [username])) return fail("That username is already taken.");

  const isSuper = !!body.isSuper;
  const perms = isSuper ? ALL_PERMISSIONS : parsePermissions(body.permissions);
  await execute("INSERT INTO admins (username, password_hash, is_super, permissions) VALUES (?, ?, ?, ?)", [
    username,
    await bcrypt.hash(String(body.password), 12),
    isSuper ? 1 : 0,
    JSON.stringify(perms),
  ]);
  return json({ ok: true, message: `Admin "${username}" created.` });
}, "super");
