import { adminRoute, fail, json } from "@/lib/auth";
import { execute, query } from "@/lib/db";

/** Every member, for matching against the broker's client list by email. */
export const GET = adminRoute(async () => {
  const members = await query<{ id: number; email: string; name: string | null; is_blocked: number }>(
    "SELECT id, email, name, is_blocked FROM members ORDER BY id"
  );
  return json({ ok: true, members: members.map((m) => ({ id: m.id, email: m.email.toLowerCase(), name: m.name, blocked: !!m.is_blocked })) });
}, "members.manage");

/** Blocks or unblocks the given members. body: { memberIds: number[], action?: "block" | "unblock" } */
export const POST = adminRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.memberIds) ? [...new Set<number>(body.memberIds.map(Number).filter(Number.isInteger))] : [];
  if (!ids.length) return fail("No members selected.");
  const unblock = body.action === "unblock";

  let changed = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const r = await execute(
      `UPDATE members SET is_blocked = ? WHERE is_blocked = ? AND id IN (${chunk.map(() => "?").join(",")})`,
      [unblock ? 0 : 1, unblock ? 1 : 0, ...chunk]
    );
    changed += r.affectedRows;
  }
  return json({ ok: true, changed, message: `${changed} member${changed === 1 ? "" : "s"} ${unblock ? "unblocked" : "blocked"}.` });
}, "members.manage");
