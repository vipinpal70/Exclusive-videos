import crypto from "crypto";
import { after, NextResponse } from "next/server";
import { handleUpdate, type TgUpdate } from "@/lib/bot";
import { getSettings } from "@/lib/settings";

export const maxDuration = 120;

function secretMatches(expected: string, given: string | null) {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Telegram bot webhook. Connect it from Admin → Settings → Telegram bot.
 * Requests must carry the secret token we registered with setWebhook.
 */
export async function POST(req: Request) {
  const s = await getSettings();
  if (!secretMatches(s.telegram_webhook_secret, req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  // Reply to Telegram straight away (so it doesn't retry), then process the update.
  if (update) after(() => handleUpdate(update, s).catch((e) => console.error("Bot update failed:", e)));
  return NextResponse.json({ ok: true });
}
