import { adminRoute, fail, json } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { checkEligibility, lookupClient } from "@/lib/elefin";
import { sendEmail, otpEmailHtml } from "@/lib/email";
import { getSettings, setSettings } from "@/lib/settings";
import { getMe, tg } from "@/lib/telegram";
import { checkXmAccount, isLoginId } from "@/lib/xm";

/** Connection tests for each integration. body: { type: "elefin" | "telegram" | "email", email?: string } */
const TEST_PERMISSION: Record<string, Permission> = {
  elefin: "settings.elefin",
  xm: "settings.xm",
  telegram: "settings.telegram",
  email: "settings.email",
};

export const POST = adminRoute(async (req, _ctx, admin) => {
  const { type, email } = await req.json().catch(() => ({}));
  if (TEST_PERMISSION[type] && !can(admin, TEST_PERMISSION[type])) return fail("You don't have permission to run this test.", 403);
  const s = await getSettings();

  try {
    if (type === "elefin") {
      if (!email) return fail("Enter an email to look up.");
      const r = await lookupClient(String(email).trim().toLowerCase(), s);
      if (!r.found) return json({ ok: true, message: `API reachable — no client found (${r.message}).`, data: r.raw });
      const e = checkEligibility(r.client, s);
      return json({
        ok: true,
        message: `Found ${r.client.name} · ${e.lots} lots · ${e.eligible ? "ELIGIBLE" : `NOT eligible: ${e.reason}`}`,
        data: r.raw,
      });
    }

    if (type === "xm") {
      const id = String(email ?? "").replace(/\s+/g, "");
      if (!isLoginId(id)) return fail("Enter an MT5 account ID (numbers only).");
      const x = await checkXmAccount(id, s);
      if (!x.found) return json({ ok: true, message: `XM API reachable — account ${id} isn't under your affiliation.` });
      const t = x.trader!;
      const flags = [t.validated ? "validated" : "not validated", t.archived ? "archived" : "active", x.balanceOk === null ? null : x.balanceOk ? "balance above threshold" : "balance below threshold"]
        .filter(Boolean)
        .join(", ");
      return json({
        ok: true,
        message: `Found ${id} (${t.accountType ?? "account"}, ${flags}) · ${x.activity.lots} lots in ${x.windowDays} days · ${x.eligible ? "ELIGIBLE" : `NOT eligible: ${x.reason}`}`,
        data: x,
      });
    }

    if (type === "telegram") {
      const me = await getMe(s.telegram_bot_token);
      if (me.username !== s.telegram_bot_username) await setSettings({ telegram_bot_username: me.username });
      let extra = "";
      if (s.telegram_test_chat_id) {
        await tg(s.telegram_bot_token, "sendMessage", { chat_id: s.telegram_test_chat_id, text: "✅ Test message from your mentorship bot." });
        extra = ` Test message sent to ${s.telegram_test_chat_id}.`;
      }
      if (!s.telegram_client_id || !s.telegram_client_secret) extra += " Telegram Login is not set up yet: add the client ID and secret.";
      else if (s.telegram_client_id !== String(me.id)) extra += ` Warning: login client ID (${s.telegram_client_id}) doesn't match this bot's ID (${me.id}).`;
      else extra += " Telegram Login client ID matches.";
      return json({ ok: true, message: `Connected to @${me.username} (${me.first_name}).${extra}`, data: me });
    }

    if (type === "email") {
      if (!email) return fail("Enter a recipient email.");
      const id = await sendEmail(s, String(email).trim(), "Test: your verification code", otpEmailHtml("123456", s.site_name, Number(s.otp_expiry_minutes) || 10, s.email_header), "Test email. Code: 123456");
      return json({ ok: true, message: `Test OTP email sent (id ${id}).` });
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  return fail("Unknown test type.");
});
