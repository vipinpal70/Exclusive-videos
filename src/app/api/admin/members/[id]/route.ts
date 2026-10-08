import { adminRoute, fail, json } from "@/lib/auth";
import { execute, query, queryOne } from "@/lib/db";
import { checkEligibility, lookupClient } from "@/lib/elefin";
import { deliverVideos, getMember, upsertMemberFromLookup } from "@/lib/members";
import { getSettings } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };

export const GET = adminRoute<Ctx>(async (_req, { params }) => {
  const id = Number((await params).id);
  const member = await queryOne("SELECT * FROM members WHERE id = ?", [id]);
  if (!member) return fail("Member not found.", 404);
  const deliveries = await query(
    `SELECT d.*, v.title FROM deliveries d LEFT JOIN videos v ON v.id = d.video_id WHERE d.member_id = ? ORDER BY d.id DESC LIMIT 200`,
    [id]
  );
  return json({ ok: true, member, deliveries });
});

/** body.action: block | unblock | unlink_telegram | reset_delivery | refresh | deliver */
export const POST = adminRoute<Ctx>(async (req, { params }) => {
  const id = Number((await params).id);
  const m = await getMember(id);
  if (!m) return fail("Member not found.", 404);
  const { action } = await req.json().catch(() => ({}));

  switch (action) {
    case "block":
      await execute("UPDATE members SET is_blocked = 1 WHERE id = ?", [id]);
      return json({ ok: true, message: "Member blocked." });
    case "unblock":
      await execute("UPDATE members SET is_blocked = 0 WHERE id = ?", [id]);
      return json({ ok: true, message: "Member unblocked." });
    case "unlink_telegram":
      await execute(
        "UPDATE members SET telegram_id = NULL, telegram_username = NULL, telegram_name = NULL, telegram_photo_url = NULL, telegram_linked_at = NULL WHERE id = ?",
        [id]
      );
      return json({ ok: true, message: "Telegram unlinked. The user can connect a new account." });
    case "reset_delivery":
      await execute("UPDATE members SET last_delivered_at = NULL WHERE id = ?", [id]);
      return json({ ok: true, message: "Delivery reset. The user can request videos again." });
    case "refresh": {
      const s = await getSettings();
      const r = await lookupClient(m.email, s);
      if (!r.found) return fail(`Elefin: ${r.message}`);
      const e = checkEligibility(r.client, s);
      await upsertMemberFromLookup(m.email, r.client, e, r.raw);
      return json({ ok: true, message: `Refreshed: ${e.lots} lots, ${e.eligible ? "eligible" : `not eligible — ${e.reason}`}` });
    }
    case "deliver": {
      if (!m.telegram_id) return fail("Member has no Telegram linked.");
      const s = await getSettings();
      const report = await deliverVideos(m, s);
      return json({ ok: true, message: `Sent ${report.sent} video(s), ${report.failed} failed.`, report });
    }
  }
  return fail("Unknown action.");
}, "members.manage");

export const DELETE = adminRoute<Ctx>(async (_req, { params }) => {
  const id = Number((await params).id);
  await execute("DELETE FROM deliveries WHERE member_id = ?", [id]);
  await execute("DELETE FROM members WHERE id = ?", [id]);
  return json({ ok: true });
}, "members.manage");
