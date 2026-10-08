import { adminRoute, fail, json } from "@/lib/auth";
import { getSettings, setSettings } from "@/lib/settings";
import { tg } from "@/lib/telegram";
import { publicOrigin, randomToken } from "@/lib/telegram-oauth";

const WEBHOOK_PATH = "/api/bot/webhook";

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

/** Current webhook status, compared with the URL for the domain the admin panel is open on. */
export const GET = adminRoute(async (req) => {
  const s = await getSettings();
  const expected = `${publicOrigin(req)}${WEBHOOK_PATH}`;
  if (!s.telegram_bot_token) return json({ ok: true, configured: false, expected });
  const info = await tg<WebhookInfo>(s.telegram_bot_token, "getWebhookInfo");
  return json({
    ok: true,
    configured: true,
    url: info.url || null,
    expected,
    connected: !!info.url && info.url === expected && !!s.telegram_webhook_secret,
    pending: info.pending_update_count,
    lastError: info.last_error_message ?? null,
    lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
  });
});

/** Points the bot's webhook at this domain with a fresh secret token. */
export const POST = adminRoute(async (req) => {
  const s = await getSettings();
  if (!s.telegram_bot_token) return fail("Save the bot token first.");
  const origin = publicOrigin(req);
  if (!origin.startsWith("https://")) {
    return fail("Telegram needs a public HTTPS address. Open the admin panel through your HTTPS domain (or ngrok) and try again.");
  }

  const secret = randomToken();
  await tg(s.telegram_bot_token, "setWebhook", {
    url: `${origin}${WEBHOOK_PATH}`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await tg(s.telegram_bot_token, "setMyCommands", {
    commands: [
      { command: "videos", description: "Show your mentorship videos" },
      { command: "start", description: "Start the bot" },
    ],
  }).catch(() => {});
  await setSettings({ telegram_webhook_secret: secret, public_site_url: origin });
  return json({ ok: true, message: `Webhook connected to ${origin}${WEBHOOK_PATH}.` });
}, "settings.telegram");

export const DELETE = adminRoute(async () => {
  const s = await getSettings();
  if (!s.telegram_bot_token) return fail("Save the bot token first.");
  await tg(s.telegram_bot_token, "deleteWebhook", {});
  await setSettings({ telegram_webhook_secret: "" });
  return json({ ok: true, message: "Webhook disconnected. The bot will no longer reply to messages." });
}, "settings.telegram");
