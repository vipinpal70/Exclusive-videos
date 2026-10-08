import "server-only";
import crypto from "crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// Telegram Login (OpenID Connect): https://core.telegram.org/bots/telegram-login
const ISSUER = "https://oauth.telegram.org";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

/** Scopes: user identity, profile (name, username, photo) and permission for the bot to message the user. */
export const TELEGRAM_SCOPES = "openid profile telegram:bot_access";
export const CALLBACK_PATH = "/api/telegram/callback";
/** Short-lived cookie holding state, PKCE verifier and nonce between /start and /callback. */
export const OAUTH_COOKIE = "ev_tg_oauth";

const b64url = (buf: Buffer) => buf.toString("base64url");
export const randomToken = () => b64url(crypto.randomBytes(32));

export function pkcePair() {
  const verifier = randomToken();
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Public origin of this site, respecting reverse-proxy headers. Must match a URL registered in BotFather. */
export function publicOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string }) {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: TELEGRAM_SCOPES,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  });
  // Encode spaces as %20 (not "+") to match Telegram's documented request format.
  return `${ISSUER}/auth?${q.toString().replaceAll("+", "%20")}`;
}

export async function exchangeCode(p: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }) {
  const res = await fetch(`${ISSUER}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${p.clientId}:${p.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      code_verifier: p.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => null)) as { id_token?: string; error?: string; error_description?: string } | null;
  if (!res.ok || !body?.id_token) {
    throw new Error(`Telegram token exchange failed: ${body?.error_description || body?.error || `HTTP ${res.status}`}`);
  }
  return body.id_token;
}

export interface TelegramIdentity {
  id: string;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
}

/** Verifies the ID token signature (JWKS), issuer, audience, expiry and nonce, then returns the user. */
export async function verifyIdToken(idToken: string, clientId: string, nonce: string): Promise<TelegramIdentity> {
  const { payload } = await jwtVerify<JWTPayload & Record<string, unknown>>(idToken, JWKS, { issuer: ISSUER, audience: clientId });
  if (payload.nonce !== undefined && payload.nonce !== nonce) throw new Error("Telegram login nonce mismatch");

  const id = payload.id ?? payload.sub;
  if (id === undefined || id === null || !/^\d+$/.test(String(id))) throw new Error("Telegram login did not return a user ID");
  const name =
    (payload.name as string | undefined) || [payload.given_name, payload.family_name].filter(Boolean).join(" ") || null;
  return {
    id: String(id),
    name,
    username: (payload.preferred_username as string | undefined) ?? null,
    photoUrl: (payload.picture as string | undefined) ?? null,
  };
}
