import { clientIp, fail, getUser, json, publicRoute } from "@/lib/auth";
import { issueOtp } from "@/lib/otp";
import { getSettings } from "@/lib/settings";

export const POST = publicRoute(async (req) => {
  const user = await getUser();
  if (!user) return fail("Session expired. Please enter your email again.", 401);
  const s = await getSettings();
  const r = await issueOtp(s, user.email, clientIp(req));
  if (!r.ok) return fail(r.error, 429, { retryAfter: r.retryAfter });
  return json({ ok: true });
});
