import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clientIp, fail, publicRoute } from "@/lib/auth";
import { checkLoggedInUser, CsError, normalizePhone, sendOtp, verifyOtp, verifyPin, type CsJar } from "@/lib/coinswitch";
import { canSendCsOtp } from "@/lib/cs-login";
import { logLookup, lookupsFromIp, memberKey, publicMember, upsertCsMember } from "@/lib/members";
import { cookieOptions, openData, sealData, signToken, USER_COOKIE } from "@/lib/session";
import { bool, getSettings } from "@/lib/settings";

const USER_TTL = 60 * 60 * 24;
const LOGIN_COOKIE = "ev_cs";
const LOGIN_AUD = "cs-login";
const LOGIN_TTL = 60 * 10;

interface LoginState {
  phone: string;
  jar: CsJar;
  step: "otp" | "pin";
}

const loginCookie = (value: string, maxAge: number) => ({ ...cookieOptions(maxAge), path: "/api/verify/coinswitch", value, name: LOGIN_COOKIE });

async function withState(res: NextResponse, state: LoginState | null) {
  res.cookies.set(state ? loginCookie(await sealData(state, LOGIN_TTL, LOGIN_AUD), LOGIN_TTL) : loginCookie("", 0));
  return res;
}

function csFail(e: unknown, state: LoginState | null, restart = false) {
  const message =
    e instanceof CsError ? e.message : "CoinSwitch login is temporarily unavailable. Please try again later.";
  if (!(e instanceof CsError)) console.error("CoinSwitch login failed:", e);
  return withState(fail(message, e instanceof CsError ? 400 : 502, { restart }), restart ? null : state);
}

/**
 * CoinSwitch verification. The client logs in to CoinSwitch with their own phone, SMS code and PIN,
 * one step per request:
 *   { step: "otp", phone } → { step: "verify", otp } → { step: "pin", pin }
 * Between steps the CoinSwitch cookies live in an encrypted, short-lived cookie in the visitor's browser.
 * After the PIN, the app reads the referrer's ref code (and basic KYC when required) and discards the login.
 */
export const POST = publicRoute(async (req) => {
  const s = await getSettings();
  if (!bool(s.cs_enabled) || !s.cs_ref_code?.trim()) return fail("CoinSwitch verification is not available right now.", 404);

  const body = await req.json().catch(() => ({}));
  const ip = clientIp(req);
  if ((await lookupsFromIp(ip, 10)) >= 20) return fail("Too many attempts. Please wait a few minutes.", 429);
  const state = await openData<LoginState>((await cookies()).get(LOGIN_COOKIE)?.value, LOGIN_AUD);

  if (body.step === "otp") {
    const digits = String(body.phone ?? "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return fail("Enter the phone number registered with CoinSwitch.");
    const phone = normalizePhone(String(body.phone));
    const limit = canSendCsOtp(ip, phone);
    if (!limit.ok) return fail(limit.error, 429, { retryAfter: limit.retryAfter });
    try {
      const jar = await sendOtp(phone);
      return withState(NextResponse.json({ ok: true, phone }), { phone, jar, step: "otp" });
    } catch (e) {
      return csFail(e, null, true);
    }
  }

  if (body.step === "verify") {
    if (!state || state.step !== "otp") return fail("Your login timed out. Please start again.", 400, { restart: true });
    const otp = String(body.otp ?? "").replace(/\s+/g, "");
    if (!/^\d{4,8}$/.test(otp)) return fail("Enter the code from the SMS.");
    try {
      const jar = await verifyOtp(state.phone, otp, state.jar);
      return withState(NextResponse.json({ ok: true }), { phone: state.phone, jar, step: "pin" });
    } catch (e) {
      const final = e instanceof CsError && (e.code === "new_user" || e.code === "no_pin");
      if (final && e.code === "new_user") {
        return withState(fail(e.message, 404, { code: "not_found", signupUrl: s.cs_signup_url || null }), null);
      }
      return csFail(e, state, final);
    }
  }

  if (body.step === "pin") {
    if (!state || state.step !== "pin") return fail("Your login timed out. Please start again.", 400, { restart: true });
    const pin = String(body.pin ?? "").trim();
    if (!/^\d{4,8}$/.test(pin)) return fail("Enter your CoinSwitch PIN.");

    let check;
    try {
      const { jar } = await verifyPin(pin, state.jar);
      check = await checkLoggedInUser(jar, s);
    } catch (e) {
      // A wrong PIN can be retried with the same login; anything after the PIN means starting again.
      return csFail(e, state, e instanceof CsError && e.code === "expired");
    }

    const key = `cs:${check.clientId}`;
    if (!check.affiliated) {
      await logLookup(key, false, false, null, check.reason, ip);
      return withState(fail(check.reason!, 404, { code: "not_found", signupUrl: s.cs_signup_url || null }), null);
    }

    const member = await upsertCsMember(check.clientId, state.phone, check);
    await logLookup(key, true, check.eligible, null, check.reason, ip);

    if (member.is_blocked) return withState(fail("Access for this account has been disabled. Please contact support.", 403, { code: "blocked" }), null);
    if (!check.eligible) return withState(fail(check.reason!, 403, { code: "not_eligible", signupUrl: s.cs_signup_url || null }), null);

    const res = NextResponse.json({ ok: true, step: "telegram", member: publicMember(member, true) });
    res.cookies.set(USER_COOKIE, await signToken({ mid: member.id, email: memberKey(member), ev: true }, USER_TTL, "user"), cookieOptions(USER_TTL));
    return withState(res, null);
  }

  return fail("Unknown step.");
});
