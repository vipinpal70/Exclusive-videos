import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { linkTelegram } from "@/lib/members";
import { verifyToken } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { exchangeCode, OAUTH_COOKIE, publicOrigin, verifyIdToken } from "@/lib/telegram-oauth";

interface OAuthState {
  state: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  mid: number;
}

/** Telegram redirects here with ?code&state. Exchange the code, verify the ID token, then link the account. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const done = (q: string) => {
    const res = NextResponse.redirect(`${origin}/?${q}`);
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  const failWith = (msg: string) => done(`tg_error=${encodeURIComponent(msg)}`);

  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${OAUTH_COOKIE}=([^;]+)`))?.[1];
  const saved = await verifyToken<OAuthState>(cookie, "tg-oauth");

  if (url.searchParams.get("error")) {
    const cancelled = url.searchParams.get("error") === "access_denied";
    return failWith(cancelled ? "Telegram login was cancelled." : `Telegram login failed: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`);
  }
  if (!saved) return failWith("Your Telegram login expired. Please try again.");
  if (url.searchParams.get("state") !== saved.state) return failWith("Telegram login could not be verified. Please try again.");

  const user = await getUser();
  if (!user || !user.ev || user.mid !== saved.mid) return failWith("Your session expired. Please verify your email again.");

  const code = url.searchParams.get("code");
  if (!code) return failWith("Telegram did not return a login code. Please try again.");

  const s = await getSettings();
  let identity;
  try {
    const idToken = await exchangeCode({
      clientId: s.telegram_client_id,
      clientSecret: s.telegram_client_secret,
      code,
      redirectUri: saved.redirectUri,
      verifier: saved.verifier,
    });
    identity = await verifyIdToken(idToken, s.telegram_client_id, saved.nonce);
  } catch (e) {
    console.error("Telegram login failed:", e);
    return failWith("Telegram login could not be completed. Please try again.");
  }

  const result = await linkTelegram(user.mid, identity, s.telegram_bot_token);
  if (!result.ok) return failWith(result.error);
  return done(result.canMessage ? "tg=linked" : "tg=linked&tg_msg=0");
}
