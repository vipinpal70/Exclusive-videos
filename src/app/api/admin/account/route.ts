import bcrypt from "bcryptjs";
import { adminRoute, fail, json } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";

/** The signed-in admin's own profile and permissions. */
export const GET = adminRoute(async (_req, _ctx, admin) => json({ ok: true, me: admin }));

/** Change your own password. body: { current, password } */
export const POST = adminRoute(async (req, _ctx, admin) => {
  const body = await req.json().catch(() => ({}));
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM admins WHERE id = ?", [admin.id]);
  if (!row || !(await bcrypt.compare(String(body.current ?? ""), row.password_hash))) return fail("Current password is incorrect.");
  if (String(body.password ?? "").length < 8) return fail("New password must be at least 8 characters.");
  await execute("UPDATE admins SET password_hash = ? WHERE id = ?", [await bcrypt.hash(String(body.password), 12), admin.id]);
  return json({ ok: true, message: "Password updated." });
});
