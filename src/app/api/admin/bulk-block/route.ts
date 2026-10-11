import { adminRoute, fail, json } from "@/lib/auth";
import { execute, query } from "@/lib/db";
import { bool, getSettings } from "@/lib/settings";

/** Every member, for matching against the broker's client list by email. */
export const GET = adminRoute(async () => {
  const members = await query<{ id: number; email: string | null; broker: string; broker_account_id: string | null; name: string | null; is_blocked: number }>(
    "SELECT id, email, broker, broker_account_id, name, is_blocked FROM members ORDER BY id"
  );
  const s = await getSettings();
  return json({
    ok: true,
    xmEnabled: bool(s.xm_enabled) && !!s.xm_api_token,
    csEnabled: bool(s.cs_enabled),
    csLastSyncAt: s.cs_last_sync_at || null,
    members: members.map((m) => ({
      id: m.id,
      broker: m.broker,
      email: (m.email ?? "").toLowerCase(),
      accountId: m.broker_account_id,
      name: m.name,
      blocked: !!m.is_blocked,
    })),
  });
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
