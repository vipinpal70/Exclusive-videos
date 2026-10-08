import { fail, getUser, json, publicRoute } from "@/lib/auth";
import { deliveryBlockReason, getMember, memberVideos } from "@/lib/members";
import { bool, getSettings, num } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The signed-in member's video list with per-video availability. */
export const GET = publicRoute(async () => {
  const user = await getUser();
  if (!user || !user.ev) return fail("Please verify your email first.", 401);
  const member = await getMember(user.mid);
  if (!member) return fail("Account not found.", 404);
  const block = deliveryBlockReason(member);
  if (block) return fail(block, 403);

  const s = await getSettings();
  return json({
    ok: true,
    videos: await memberVideos(member, s),
    allowRedelivery: bool(s.allow_redelivery),
    cooldownMinutes: num(s.redelivery_cooldown_minutes),
    botUsername: s.telegram_bot_username,
  });
});
