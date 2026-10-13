import { adminRoute, fail, json } from "@/lib/auth";
import { execute, query, queryOne } from "@/lib/db";
import { checkEligibility, lookupClient } from "@/lib/elefin";
import { DeliveryError, deliverVideos, getMember, setPendingVideos, upsertMemberFromLookup, upsertXmMember } from "@/lib/members";
import { checkXmAccount } from "@/lib/xm";
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
        "UPDATE members SET telegram_id = NULL, telegram_username = NULL, telegram_name = NULL, telegram_photo_url = NULL, telegram_linked_at = NULL, pending_video_ids = NULL WHERE id = ?",
        [id]
      );
      return json({ ok: true, message: "Telegram unlinked. The user can connect a new account." });
    case "reset_delivery":
      // Earlier deliveries stay in the history but no longer count towards the per-video re-delivery rules.
      await execute("UPDATE members SET last_delivered_at = NULL, delivery_reset_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
      return json({ ok: true, message: "Delivery reset. The member can request every video again right away." });
    case "refresh": {
      const s = await getSettings();
      if (m.broker === "coinswitch") {
        // CoinSwitch is checked with the client's own CoinSwitch login, so only the client can re-check it.
        return fail("CoinSwitch members are re-checked when they log in with CoinSwitch on the website again.");
      }
      if (m.broker === "xm") {
        const x = await checkXmAccount(m.broker_account_id!, s);
        if (!x.found) return fail("XM: this account is no longer under your affiliation.");
        await upsertXmMember(m.broker_account_id!, x);
        return json({ ok: true, message: `Refreshed from XM: ${x.activity.lots} lots in ${x.windowDays} days, ${x.eligible ? "eligible" : `not eligible: ${x.reason}`}` });
      }
      const r = await lookupClient(m.email!, s);
      if (!r.found) return fail(`Elefin: ${r.message}`);
      const e = checkEligibility(r.client, s);
      await upsertMemberFromLookup(m.email!, r.client, e, r.raw);
      return json({ ok: true, message: `Refreshed: ${e.lots} lots, ${e.eligible ? "eligible" : `not eligible — ${e.reason}`}` });
    }
    case "deliver": {
      if (!m.telegram_id) return fail("Member has no Telegram linked.");
      const s = await getSettings();
      try {
        // Admin sends ignore the re-delivery and cooldown rules.
        const report = await deliverVideos(m, s, { force: true });
        return json({ ok: true, message: `Sent ${report.sent} video(s), ${report.failed} failed.`, report });
      } catch (e) {
        if (e instanceof DeliveryError && e.code === "need_start") {
          await setPendingVideos(m.id, e.pendingIds);
          return fail("The bot can't message this member yet. The videos will be sent automatically when they open the bot and press Start.", 409);
        }
        return fail((e as Error).message);
      }
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
