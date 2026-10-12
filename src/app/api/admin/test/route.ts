import { adminRoute, fail, json } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { checkEligibility, lookupClient } from "@/lib/elefin";
import { sendEmail, otpEmailHtml } from "@/lib/email";
import { getSettings, setSettings } from "@/lib/settings";
import { getMe, tg } from "@/lib/telegram";
import { checkXmAccount, isLoginId } from "@/lib/xm";
import { cachedLead, isDone, syncLeads } from "@/lib/coinswitch";
import { bool } from "@/lib/settings";

/** Connection tests for each integration. body: { type: "elefin" | "telegram" | "email", email?: string } */
const TEST_PERMISSION: Record<string, Permission> = {
  elefin: "settings.elefin",
  xm: "settings.xm",
  coinswitch: "settings.coinswitch",
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

    if (type === "coinswitch") {
      const id = Number(String(email ?? "").replace(/\s+/g, ""));
      if (!Number.isSafeInteger(id) || id <= 0) return fail("Enter a CoinSwitch client ID (numbers only).");
      let lead = await cachedLead(id);
      if (!lead) {
        await syncLeads(s, id);
        lead = await cachedLead(id);
      }
      if (!lead) return json({ ok: true, message: `Client ${id} isn't in your CoinSwitch affiliate leads.` });
      const steps = { KYC: lead.kyc_status, Bank: lead.bank_status, Deposit: lead.deposit_status, Trade: lead.trade_status };
      const required = { KYC: bool(s.cs_require_kyc), Bank: bool(s.cs_require_bank), Deposit: bool(s.cs_require_deposit), Trade: bool(s.cs_require_trade) };
      const missing = Object.entries(steps).filter(([k, v]) => required[k as keyof typeof required] && !isDone(v)).map(([k]) => k);
      return json({
        ok: true,
        message: `Found client ${id}${lead.user_name ? ` (${lead.user_name})` : ""}, phone ••••${lead.phone_last4 ?? "????"} · ${Object.entries(steps)
          .map(([k, v]) => `${k}: ${v ?? "—"}`)
          .join(", ")} · ${missing.length ? `NOT eligible (missing: ${missing.join(", ")})` : "ELIGIBLE"}`,
        data: lead,
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
