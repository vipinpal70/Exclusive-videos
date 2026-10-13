import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminRoute, fail } from "@/lib/auth";
import { CsError, normalizePhone, savePartnerLogin, sendOtp, verifyOtp, verifyPin, type CsJar } from "@/lib/coinswitch";
import { cookieOptions, openData, sealData } from "@/lib/session";
import { setSettings } from "@/lib/settings";

const LOGIN_COOKIE = "ev_csa";
const LOGIN_AUD = "cs-partner-login";
const LOGIN_TTL = 60 * 10;

interface LoginState {
  phone: string;
  jar: CsJar;
  step: "otp" | "pin";
}

async function reply(data: Record<string, unknown>, state: LoginState | null, status = 200) {
  const res = NextResponse.json(data, { status });
  res.cookies.set({
    ...cookieOptions(state ? LOGIN_TTL : 0),
    path: "/api/admin/coinswitch",
    name: LOGIN_COOKIE,
    value: state ? await sealData(state, LOGIN_TTL, LOGIN_AUD) : "",
  });
  return res;
}

/**
 * Partner login, used only to fetch leads for bulk block / unblock. One step per request:
 *   { step: "otp", phone }  → CoinSwitch texts an OTP to the phone
 *   { step: "verify", otp } → OTP gives the "rft" cookie (kept encrypted in this browser until the PIN step)
 *   { step: "pin", pin }    → PIN gives the "st" access token; rft + st are saved (the PIN is never stored)
 */
export const POST = adminRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const state = await openData<LoginState>((await cookies()).get(LOGIN_COOKIE)?.value, LOGIN_AUD);
  try {
    if (body.step === "otp") {
      const digits = String(body.phone ?? "").replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) return fail("Enter the phone number registered with your CoinSwitch partner account.");
      const phone = normalizePhone(String(body.phone));
      const jar = await sendOtp(phone);
      return reply({ ok: true, message: `OTP sent to ${phone}.` }, { phone, jar, step: "otp" });
    }
    if (body.step === "verify") {
      if (!state || state.step !== "otp") return fail("The login timed out. Send the OTP again.");
      const otp = String(body.otp ?? "").replace(/\s+/g, "");
      if (!/^\d{4,8}$/.test(otp)) return fail("Enter the OTP from the SMS.");
      const jar = await verifyOtp(state.phone, otp, state.jar);
      return reply({ ok: true, message: "OTP verified. Now enter your CoinSwitch PIN." }, { ...state, jar, step: "pin" });
    }
    if (body.step === "pin") {
      if (!state || state.step !== "pin") return fail("The login timed out. Send the OTP again.");
      const pin = String(body.pin ?? "").trim();
      if (!/^\d{4,8}$/.test(pin)) return fail("Enter your CoinSwitch PIN.");
      const { jar, expiresAt } = await verifyPin(pin, state.jar);
      await savePartnerLogin(state.phone, jar, expiresAt);
      return reply({ ok: true, message: "CoinSwitch connected.", expiresAt: expiresAt.toISOString() }, null);
    }
    if (body.step === "disconnect") {
      await setSettings({ cs_access_token: "", cs_token_expires_at: "", cs_refresh_token: "" });
      return reply({ ok: true, message: "CoinSwitch partner login removed." }, null);
    }
  } catch (e) {
    return fail(e instanceof CsError ? e.message : `CoinSwitch login failed: ${(e as Error).message}`);
  }
  return fail("Unknown step.");
}, "settings.coinswitch");
