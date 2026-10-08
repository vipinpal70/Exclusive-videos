import bcrypt from "bcryptjs";
import { adminRoute, fail, json } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { ALL_PERMISSIONS, parsePermissions } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };

const USERNAME_RE = /^[a-zA-Z0-9_.@-]{3,100}$/;

async function otherSuperCount(id: number) {
  const r = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM admins WHERE is_super = 1 AND id <> ?", [id]);
  return Number(r?.c ?? 0);
}

/** Update username, permissions, super status and/or reset the password. */
export const PUT = adminRoute<Ctx>(async (req, { params }, me) => {
  const id = Number((await params).id);
  const target = await queryOne<{ id: number; username: string; is_super: number }>("SELECT id, username, is_super FROM admins WHERE id = ?", [id]);
  if (!target) return fail("Admin not found.", 404);

  const body = await req.json().catch(() => ({}));
  const isSuper = !!body.isSuper;
  if (target.is_super && !isSuper) {
    if (id === me.id) return fail("You can't remove your own super admin access.");
    if ((await otherSuperCount(id)) === 0) return fail("There must be at least one super admin.");
  }

  const username = body.username !== undefined ? String(body.username).trim() : target.username;
  if (!USERNAME_RE.test(username)) return fail("Username must be 3+ characters (letters, numbers, _ . @ -).");
  if (username !== target.username && (await queryOne("SELECT id FROM admins WHERE username = ? AND id <> ?", [username, id]))) {
    return fail("That username is already taken.");
  }

  const perms = isSuper ? ALL_PERMISSIONS : parsePermissions(body.permissions);
  await execute("UPDATE admins SET username = ?, is_super = ?, permissions = ? WHERE id = ?", [username, isSuper ? 1 : 0, JSON.stringify(perms), id]);

  if (body.password) {
    if (String(body.password).length < 8) return fail("Password must be at least 8 characters.");
    await execute("UPDATE admins SET password_hash = ? WHERE id = ?", [await bcrypt.hash(String(body.password), 12), id]);
  }
  return json({ ok: true, message: `Admin "${username}" updated.` });
}, "super");

export const DELETE = adminRoute<Ctx>(async (_req, { params }, me) => {
  const id = Number((await params).id);
  if (id === me.id) return fail("You can't delete your own account.");
  const target = await queryOne<{ is_super: number }>("SELECT is_super FROM admins WHERE id = ?", [id]);
  if (!target) return fail("Admin not found.", 404);
  if (target.is_super && (await otherSuperCount(id)) === 0) return fail("There must be at least one super admin.");
  await execute("DELETE FROM admins WHERE id = ?", [id]);
  return json({ ok: true, message: "Admin deleted." });
}, "super");
