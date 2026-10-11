import { NextResponse } from "next/server";
import { clientIp, fail, publicRoute } from "@/lib/auth";
import { checkCsClient, CsError, normalizePhone } from "@/lib/coinswitch";
import { logLookup, lookupsFromIp, memberKey, publicMember, upsertCsMember } from "@/lib/members";
import { cookieOptions, signToken, USER_COOKIE } from "@/lib/session";
import { bool, getSettings } from "@/lib/settings";

const USER_TTL = 60 * 60 * 24;

/**
 * Verifies a CoinSwitch client by client ID + phone number. The lead list stays on the server:
 * the response only ever describes the client being checked.
 */
export const POST = publicRoute(async (req) => {
  const s = await getSettings();
  if (!bool(s.cs_enabled)) return fail("CoinSwitch verification is not available right now.", 404);

  const body = await req.json().catch(() => ({}));
  const clientId = Number(String(body.clientId ?? "").replace(/\s+/g, ""));
  const phoneDigits = String(body.phone ?? "").replace(/\D/g, "");
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return fail("Enter your CoinSwitch client ID (numbers only).");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return fail("Enter the phone number registered with CoinSwitch.");
  const phone = normalizePhone(String(body.phone));

  const ip = clientIp(req);
  if ((await lookupsFromIp(ip, 10)) >= 20) return fail("Too many attempts. Please wait a few minutes.", 429);

  let check;
  try {
    check = await checkCsClient(clientId, phone, s);
  } catch (e) {
    console.error("CoinSwitch lookup failed:", e);
    return fail(e instanceof CsError ? "Verification service is temporarily unavailable. Please try again later." : "Unexpected error.", 502);
  }

  const key = `cs:${clientId}`;
  if (!check.found) {
    await logLookup(key, false, false, null, check.reason, ip);
    return fail(check.reason!, 404, { code: "not_found", signupUrl: s.cs_signup_url || null });
  }

  const member = await upsertCsMember(clientId, phone, check);
  await logLookup(key, true, check.eligible, null, check.reason, ip);

  if (member.is_blocked) return fail("Access for this account has been disabled. Please contact support.", 403, { code: "blocked" });
  if (!check.eligible) return fail(check.reason!, 403, { code: "not_eligible", signupUrl: s.cs_signup_url || null });

  const res = NextResponse.json({ ok: true, step: "telegram", member: publicMember(member, true) });
  res.cookies.set(USER_COOKIE, await signToken({ mid: member.id, email: memberKey(member), ev: true }, USER_TTL, "user"), cookieOptions(USER_TTL));
  return res;
});
