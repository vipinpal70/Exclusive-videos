import { NextResponse } from "next/server";
import { clientIp, fail, publicRoute } from "@/lib/auth";
import { checkEligibility, ElefinError, lookupClient } from "@/lib/elefin";
import { isEmail, logLookup, lookupsFromIp, normalizeEmail, publicMember, upsertMemberFromLookup } from "@/lib/members";
import { issueOtp } from "@/lib/otp";
import { cookieOptions, signToken, USER_COOKIE } from "@/lib/session";
import { bool, getSettings } from "@/lib/settings";

const USER_TTL = 60 * 60 * 24;

export const POST = publicRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(String(body.email ?? ""));
  if (!isEmail(email)) return fail("Please enter a valid email address.");

  const ip = clientIp(req);
  if ((await lookupsFromIp(ip, 10)) >= 20) return fail("Too many attempts. Please wait a few minutes.", 429);

  const s = await getSettings();
  let result;
  try {
    result = await lookupClient(email, s);
  } catch (e) {
    console.error("Elefin lookup failed:", e);
    return fail(
      e instanceof ElefinError ? "Verification service is temporarily unavailable. Please try again later." : "Unexpected error.",
      502
    );
  }

  if (!result.found) {
    await logLookup(email, false, false, null, result.message, ip);
    return fail("We couldn't find an Elefin account with this email.", 404, { code: "not_found", signupUrl: s.signup_url?.trim() || "https://partners.elefin.com/go/YASH" });
  }

  const elig = checkEligibility(result.client, s);
  const member = await upsertMemberFromLookup(email, result.client, elig, result.raw);
  await logLookup(email, true, elig.eligible, elig.lots, elig.reason, ip);

  if (member.is_blocked) return fail("Access for this account has been disabled. Please contact support.", 403, { code: "blocked" });
  if (!elig.eligible) {
    return fail(elig.reason!, 403, { code: "not_eligible", lots: elig.lots, minLots: elig.minLots, signupUrl: s.signup_url?.trim() || "https://partners.elefin.com/go/YASH" });
  }

  const otp = bool(s.otp_enabled);
  if (otp) {
    const sent = await issueOtp(s, email, ip).catch((e) => {
      console.error("OTP send failed:", e);
      return { ok: false as const, error: "We couldn't send the verification email. Please try again later.", retryAfter: undefined };
    });
    // A cooldown error still lets the user enter the code that was already sent.
    if (!sent.ok && !sent.retryAfter) return fail(sent.error, 429);
  }

  const res = NextResponse.json({ ok: true, step: otp ? "otp" : "telegram", member: publicMember(member, !otp) });
  res.cookies.set(USER_COOKIE, await signToken({ mid: member.id, email, ev: !otp }, USER_TTL, "user"), cookieOptions(USER_TTL));
  return res;
});
