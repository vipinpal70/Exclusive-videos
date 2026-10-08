import { fail, getUser, json, publicRoute } from "@/lib/auth";
import { deliverVideos, deliveryBlockReason, getMember } from "@/lib/members";
import { getSettings } from "@/lib/settings";

export const maxDuration = 120;

// Prevent double-clicks from triggering parallel deliveries for the same member in this process.
const inFlight = new Set<number>();

export const POST = publicRoute(async () => {
  const user = await getUser();
  if (!user || !user.ev) return fail("Please verify your email first.", 401);

  const member = await getMember(user.mid);
  if (!member) return fail("Account not found.", 404);
  const s = await getSettings();
  const block = deliveryBlockReason(member, s);
  if (block) return fail(block, 403);
  if (inFlight.has(member.id)) return fail("Delivery already in progress.", 409);

  inFlight.add(member.id);
  try {
    const report = await deliverVideos(member, s);
    if (report.sent === 0) {
      return fail("We couldn't deliver the videos right now. Please try again later or contact support.", 502, { report });
    }
    return json({ ok: true, report, botUsername: s.telegram_bot_username });
  } catch (e) {
    return fail((e as Error).message, 400);
  } finally {
    inFlight.delete(member.id);
  }
});
