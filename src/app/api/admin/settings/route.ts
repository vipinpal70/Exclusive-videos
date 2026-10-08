import { adminRoute, fail, json } from "@/lib/auth";
import { can, SETTINGS_GROUP_PERMISSION } from "@/lib/permissions";
import { getSettings, getSettingsForAdmin, SETTING_DEFS, setSettings } from "@/lib/settings";
import { getMe } from "@/lib/telegram";

export const GET = adminRoute(async () => json({ ok: true, settings: await getSettingsForAdmin() }));

export const PUT = adminRoute(async (req, _ctx, admin) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, string> = {};

  for (const def of SETTING_DEFS) {
    if (!(def.key in body)) continue;
    if (!can(admin, SETTINGS_GROUP_PERMISSION[def.group])) {
      return fail("You don't have permission to edit these settings.", 403);
    }
    let v = body[def.key];
    if (def.type === "secret") {
      // Empty secret = keep current value. Use "__clear__" to remove it.
      if (v === "" || v === null || v === undefined) continue;
      if (v === "__clear__") v = "";
    }
    if (def.type === "boolean") v = v === true || v === "1" || v === "true" ? "1" : "0";
    if (def.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return fail(`${def.label} must be a positive number.`);
      v = String(n);
    }
    let str = String(v ?? "").trim();
    if (def.key === "elefin_api_base") str = str.replace(/\/+$/, "");
    if (def.type === "url" && str && !/^https?:\/\//i.test(str)) return fail(`${def.label} must start with http:// or https://`);
    updates[def.key] = str;
  }

  // When the bot token changes, look up and store the bot username automatically.
  let botNote: string | undefined;
  if (updates.telegram_bot_token) {
    try {
      const me = await getMe(updates.telegram_bot_token);
      updates.telegram_bot_username = me.username;
      botNote = `Connected to @${me.username}`;
    } catch (e) {
      return fail(`Bot token is invalid: ${(e as Error).message}`);
    }
  }

  const merged = { ...(await getSettings()), ...updates };
  if (merged.otp_enabled === "1" && (!merged.resend_api_key || !merged.resend_from_email)) {
    return fail("To enable email OTP, set the Resend API key and From email first.");
  }

  await setSettings(updates);
  return json({ ok: true, note: botNote, settings: await getSettingsForAdmin() });
});
