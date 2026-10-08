import { adminRoute, fail, json } from "@/lib/auth";
import { MAX_BATCH, sendBroadcastBatch, type BroadcastItem } from "@/lib/broadcast";
import { getSettings } from "@/lib/settings";

export const maxDuration = 60;

/** Sends one batch of a bulk send. body: { items: [memberId, videoId][] } (at most MAX_BATCH). */
export const POST = adminRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const items: BroadcastItem[] = Array.isArray(body.items)
    ? body.items
        .filter((x: unknown) => Array.isArray(x) && x.length === 2 && x.every((n) => Number.isInteger(Number(n))))
        .map(([m, v]: [unknown, unknown]) => [Number(m), Number(v)] as BroadcastItem)
    : [];
  if (!items.length) return fail("No items to send.");
  if (items.length > MAX_BATCH) return fail(`Send at most ${MAX_BATCH} messages per batch.`);

  const s = await getSettings();
  if (!s.telegram_bot_token) return fail("The Telegram bot token is not configured.");
  return json({ ok: true, results: await sendBroadcastBatch(items, s) });
}, "broadcast.send");
