import { fail, getUser, json, publicRoute } from "@/lib/auth";
import { botStartUrl, DeliveryError, deliverVideos, deliveryBlockReason, getMember, memberVideos, setPendingVideos } from "@/lib/members";
import { getSettings } from "@/lib/settings";

export const maxDuration = 120;

/**
 * Sends videos to the signed-in member's Telegram.
 * body: { videoIds?: number[] } — omit for "Get all".
 * If the bot can't message the user yet, the request is saved and the response tells the
 * website to open the bot (t.me/<bot>?start=video); pressing Start delivers them via the webhook.
 */
export const POST = publicRoute(async (req) => {
  const user = await getUser();
  if (!user || !user.ev) return fail("Please verify your email first.", 401);

  const member = await getMember(user.mid);
  if (!member) return fail("Account not found.", 404);
  const block = deliveryBlockReason(member);
  if (block) return fail(block, 403);

  const body = await req.json().catch(() => ({}));
  const videoIds = Array.isArray(body.videoIds) ? body.videoIds.map(Number).filter(Number.isInteger) : undefined;
  const s = await getSettings();

  try {
    const report = await deliverVideos(member, s, { videoIds });
    const videos = await memberVideos((await getMember(member.id))!, s);
    if (report.sent === 0) {
      return fail("We couldn't deliver the videos right now. Please try again later or contact support.", 502, { report, videos });
    }
    return json({ ok: true, report, videos, botUsername: s.telegram_bot_username });
  } catch (e) {
    if (e instanceof DeliveryError && e.code === "need_start") {
      const botUrl = botStartUrl(s);
      if (!botUrl) return fail("The Telegram bot is not configured yet. Please contact support.", 503);
      await setPendingVideos(member.id, e.pendingIds);
      return fail(e.message, 409, { code: "need_start", botUrl });
    }
    return fail((e as Error).message, 400);
  }
});
