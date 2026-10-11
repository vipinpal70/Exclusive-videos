import { NextResponse } from "next/server";
import { clientIp, fail, publicRoute } from "@/lib/auth";
import { logLookup, lookupsFromIp, memberKey, publicMember, upsertXmMember } from "@/lib/members";
import { cookieOptions, signToken, USER_COOKIE } from "@/lib/session";
import { bool, getSettings } from "@/lib/settings";
import { checkXmAccount, isLoginId, XmError } from "@/lib/xm";

const USER_TTL = 60 * 60 * 24;

/**
 * Verifies an XM client by MT5 account ID. XM's API has no emails, so there is no email OTP step;
 * the session goes straight to the Telegram step.
 */
export const POST = publicRoute(async (req) => {
  const s = await getSettings();
  if (!bool(s.xm_enabled) || !s.xm_api_token) return fail("XM verification is not available right now.", 404);

  const body = await req.json().catch(() => ({}));
  const loginId = String(body.loginId ?? "").replace(/\s+/g, "");
  if (!isLoginId(loginId)) return fail("Enter your XM MT5 account ID (numbers only).");

  const ip = clientIp(req);
  if ((await lookupsFromIp(ip, 10)) >= 20) return fail("Too many attempts. Please wait a few minutes.", 429);

  let check;
  try {
    check = await checkXmAccount(loginId, s);
  } catch (e) {
    console.error("XM lookup failed:", e);
    return fail(e instanceof XmError ? "Verification service is temporarily unavailable. Please try again later." : "Unexpected error.", 502);
  }

  const key = `xm:${loginId}`;
  if (!check.found) {
    await logLookup(key, false, false, null, check.reason, ip);
    return fail("We couldn’t find this XM account under our partner link.", 404, { code: "not_found", signupUrl: s.xm_signup_url || null });
  }

  const member = await upsertXmMember(loginId, check);
  await logLookup(key, true, check.eligible, check.activity.lots, check.reason, ip);

  if (member.is_blocked) return fail("Access for this account has been disabled. Please contact support.", 403, { code: "blocked" });
  if (!check.eligible) {
    return fail(check.reason!, 403, {
      code: "not_eligible",
      lots: check.activity.lots,
      minLots: check.minLots,
      signupUrl: s.xm_signup_url || null,
    });
  }

  const res = NextResponse.json({ ok: true, step: "telegram", member: publicMember(member, true) });
  res.cookies.set(USER_COOKIE, await signToken({ mid: member.id, email: memberKey(member), ev: true }, USER_TTL, "user"), cookieOptions(USER_TTL));
  return res;
});
