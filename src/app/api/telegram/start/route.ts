import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { cookieOptions, signToken } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { authorizeUrl, CALLBACK_PATH, OAUTH_COOKIE, pkcePair, publicOrigin, randomToken } from "@/lib/telegram-oauth";

const OAUTH_TTL = 10 * 60;

/** Starts Telegram Login: stores state/PKCE/nonce in a short-lived cookie and redirects to Telegram. */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/?${q}`);

  const user = await getUser();
  if (!user || !user.ev) return back(`tg_error=${encodeURIComponent("Please verify your email first.")}`);

  const s = await getSettings();
  if (!s.telegram_client_id || !s.telegram_client_secret) {
    return back(`tg_error=${encodeURIComponent("Telegram login is not configured yet. Please try again later.")}`);
  }

  const { verifier, challenge } = pkcePair();
  const state = randomToken();
  const nonce = randomToken();
  const redirectUri = `${origin}${CALLBACK_PATH}`;

  const res = NextResponse.redirect(authorizeUrl({ clientId: s.telegram_client_id, redirectUri, state, challenge, nonce }));
  res.cookies.set(OAUTH_COOKIE, await signToken({ state, verifier, nonce, redirectUri, mid: user.mid }, OAUTH_TTL, "tg-oauth"), cookieOptions(OAUTH_TTL));
  return res;
}
