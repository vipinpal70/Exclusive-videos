import { adminRoute, fail, json } from "@/lib/auth";
import { CsError, normalizePhone, sendLoginOtp, tokenExpiry, verifyLoginOtp, verifyLoginPin } from "@/lib/coinswitch";
import { getSettings, setSettings } from "@/lib/settings";

/**
 * CoinSwitch login, one step per request:
 *   { step: "otp", phone }  → CoinSwitch texts an OTP to the phone
 *   { step: "verify", otp } → OTP is exchanged for a refresh token (kept server-side only)
 *   { step: "pin", pin }    → refresh token + PIN give a 24-hour access token (the PIN is never stored)
 */
export const POST = adminRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const s = await getSettings();
  try {
    if (body.step === "otp") {
      const digits = String(body.phone ?? "").replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) return fail("Enter the phone number registered with your CoinSwitch partner account.");
      const phone = normalizePhone(String(body.phone));
      await sendLoginOtp(phone);
      await setSettings({ cs_phone: phone, cs_refresh_token: "" });
      return json({ ok: true, message: `OTP sent to ${phone}.` });
    }
    if (body.step === "verify") {
      if (!s.cs_phone) return fail("Send the OTP first.");
      const otp = String(body.otp ?? "").replace(/\s+/g, "");
      if (!/^\d{4,8}$/.test(otp)) return fail("Enter the OTP from the SMS.");
      const refresh = await verifyLoginOtp(s.cs_phone, otp);
      await setSettings({ cs_refresh_token: refresh });
      return json({ ok: true, message: "OTP verified. Now enter your CoinSwitch PIN." });
    }
    if (body.step === "pin") {
      if (!s.cs_refresh_token) return fail("Verify the OTP first.");
      const pin = String(body.pin ?? "").trim();
      if (!/^\d{4,8}$/.test(pin)) return fail("Enter your CoinSwitch PIN.");
      const token = await verifyLoginPin(s.cs_refresh_token, pin);
      const expiresAt = tokenExpiry(token);
      await setSettings({ cs_access_token: token, cs_token_expires_at: expiresAt.toISOString(), cs_refresh_token: "" });
      return json({ ok: true, message: "CoinSwitch connected.", expiresAt: expiresAt.toISOString() });
    }
    if (body.step === "disconnect") {
      await setSettings({ cs_access_token: "", cs_token_expires_at: "", cs_refresh_token: "" });
      return json({ ok: true, message: "CoinSwitch access token removed." });
    }
  } catch (e) {
    return fail(e instanceof CsError ? e.message : `CoinSwitch login failed: ${(e as Error).message}`);
  }
  return fail("Unknown step.");
}, "settings.coinswitch");
