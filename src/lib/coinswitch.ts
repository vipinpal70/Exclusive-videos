import "server-only";
import { query } from "./db";
import { setSettings, type Settings } from "./settings";

/*
 * CoinSwitch web API (https://coinswitch.co/pro/api/v1). Everything is cookie-based:
 *   1) POST /auth/init/auth    { phone_number, entity_type: "SMS" }              → SMS OTP
 *   2) POST /auth/verify/auth  { phone_number, proof, referral_additional_data } → "rft" cookie (refresh, ~28 days)
 *   3) POST /auth/verify/pin   { pin } with rft                                  → "st" cookie (access token)
 * With rft + st:
 *   GET  /affiliate/profile                → the referrer's { affiliate_name, ref_code }
 *   GET  /kyc/kyc_progress_status          → { basic_kyc_status, … } ("PASS" when done)
 *   POST /feature-tracker/fetch-initialise/user-progress { platform: "WEB" } → { user_id } (= client ID in leads)
 *   GET  /affiliate/leads?page=N           → the partner's leads, 500 per page (partner login only)
 *
 * Website clients log in with their own phone, OTP and PIN. Their CoinSwitch cookies are only kept
 * (encrypted, in the visitor's browser) for the few minutes the login takes, and never stored on the server.
 * The partner (admin) login is only used to fetch leads for bulk block / unblock.
 */

const API = "https://coinswitch.co/pro/api/v1";
const LEADS_URL = `${API}/affiliate/leads`;

export class CsError extends Error {
  constructor(
    message: string,
    public code?: "expired" | "not_connected" | "new_user" | "no_pin"
  ) {
    super(message);
  }
}

/** Cookies CoinSwitch has set during a login (name → value). */
export type CsJar = Record<string, string>;

const cookieHeader = (jar: CsJar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

function absorbCookies(res: Response, jar: CsJar): CsJar {
  const next = { ...jar };
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = line.split(";");
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*(0|-)/i.test(a));
    if (!value || expired) delete next[name];
    else if (value.length <= 2048) next[name] = value; // keeps the jar small enough to fit in a cookie
  }
  return next;
}

async function csCall<T>(path: string, jar: CsJar, body?: unknown): Promise<{ data: T; jar: CsJar }> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Origin: "https://coinswitch.co",
        Referer: "https://coinswitch.co/pro/",
        ...(Object.keys(jar).length ? { cookie: cookieHeader(jar) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new CsError(`Could not reach CoinSwitch: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => null)) as {
    status?: string;
    success?: boolean;
    msg?: string;
    err?: string;
    message?: string;
    data?: T;
  } | null;
  const ok = res.ok && !!json && (json.status === "success" || json.success === true);
  if (!ok) {
    const message = String(json?.msg || json?.err || json?.message || "").trim();
    if (res.status === 401 || res.status === 403) throw new CsError(message || "The CoinSwitch login has expired. Please log in again.", "expired");
    throw new CsError(message || `CoinSwitch returned HTTP ${res.status}`);
  }
  return { data: (json!.data ?? {}) as T, jar: absorbCookies(res, jar) };
}

/** Normalises a phone number to "+<digits>"; numbers without a country code are treated as Indian (+91). */
export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (input.trim().startsWith("+")) return `+${digits}`;
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}
export const lastFour = (phone: string) => phone.replace(/\D/g, "").slice(-4);

/** Step 1: CoinSwitch texts an OTP to the phone. Returns any cookies set, to carry into step 2. */
export async function sendOtp(phone: string): Promise<CsJar> {
  const r = await csCall("/auth/init/auth", {}, { phone_number: phone, entity_type: "SMS" });
  return r.jar;
}

/** Step 2: OTP → "rft" cookie. Rejects numbers that aren't CoinSwitch accounts yet or have no PIN. */
export async function verifyOtp(phone: string, otp: string, jar: CsJar): Promise<CsJar> {
  const r = await csCall<{ is_new_user?: boolean; pin_exists?: boolean }>("/auth/verify/auth", jar, {
    phone_number: phone,
    proof: otp,
    referral_additional_data: {},
  });
  if (r.data.is_new_user) throw new CsError("This phone number doesn’t have a CoinSwitch account yet.", "new_user");
  if (r.data.pin_exists === false) throw new CsError("Set up your CoinSwitch PIN in the CoinSwitch app first, then try again.", "no_pin");
  if (!r.jar.rft) throw new CsError("CoinSwitch didn’t complete the login. Please start again.");
  return r.jar;
}

/** Step 3: PIN → "st" cookie (the access token). */
export async function verifyPin(pin: string, jar: CsJar): Promise<{ jar: CsJar; expiresAt: Date }> {
  const r = await csCall<{ session_token_validity?: number }>("/auth/verify/pin", jar, { pin });
  if (!r.jar.st) throw new CsError("CoinSwitch didn’t complete the login. Please start again.");
  const v = Number(r.data.session_token_validity);
  return { jar: r.jar, expiresAt: Number.isFinite(v) && v > 0 ? new Date(v < 1e12 ? v * 1000 : v) : tokenExpiry(r.jar.st) };
}

/** The affiliate who referred the logged-in user (empty ref_code when nobody did). */
export async function affiliateProfile(jar: CsJar) {
  const r = await csCall<{ affiliate_name?: string; ref_code?: string }>("/affiliate/profile", jar);
  return { affiliateName: String(r.data.affiliate_name ?? ""), refCode: String(r.data.ref_code ?? "") };
}

export async function kycStatus(jar: CsJar) {
  const r = await csCall<Record<string, unknown>>("/kyc/kyc_progress_status", jar);
  return r.data;
}

/** The logged-in user's CoinSwitch user ID (the client ID shown in the partner's leads). */
export async function userId(jar: CsJar): Promise<number> {
  const r = await csCall<{ user_id?: number | string }>("/feature-tracker/fetch-initialise/user-progress", jar, { platform: "WEB" });
  const id = Number(r.data.user_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new CsError("CoinSwitch didn’t return your account ID. Please try again.");
  return id;
}

/** Ref codes from the setting (comma or space separated). Codes are case-sensitive. */
export const refCodes = (s: Settings) =>
  (s.cs_ref_code ?? "")
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean);

export const kycPassed = (status: unknown) => typeof status === "string" && /^PASS(ED)?$/i.test(status.trim());

export interface CsCheck {
  clientId: number;
  affiliated: boolean;
  eligible: boolean;
  reason: string | null;
  affiliateName: string;
  basicKyc: string | null;
}

/** Runs the post-login checks: the referrer's ref code, then (when required) basic KYC. */
export async function checkLoggedInUser(jar: CsJar, s: Settings): Promise<CsCheck> {
  const profile = await affiliateProfile(jar);
  const clientId = await userId(jar);
  const affiliated = !!profile.refCode && refCodes(s).includes(profile.refCode);
  const requireKyc = s.cs_require_kyc === "1";
  let basicKyc: string | null = null;
  if (affiliated && requireKyc) {
    const k = await kycStatus(jar);
    basicKyc = typeof k.basic_kyc_status === "string" ? k.basic_kyc_status : null;
  }
  const reason = !affiliated
    ? "Your CoinSwitch account wasn’t opened with our referral link."
    : requireKyc && !kycPassed(basicKyc)
      ? "To unlock the videos, please complete your basic KYC on CoinSwitch."
      : null;
  return { clientId, affiliated, eligible: !reason, reason, affiliateName: profile.affiliateName, basicKyc };
}

/** Expiry from the token's "validity" (CoinSwitch) or "exp" claim; falls back to 24 hours from now. */
export function tokenExpiry(jwt: string): Date {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    const t = Number(payload.validity ?? payload.exp);
    if (Number.isFinite(t) && t > 0) return new Date(t < 1e12 ? t * 1000 : t);
  } catch {
    /* not a readable JWT */
  }
  return new Date(Date.now() + 24 * 3600_000);
}

/** The partner login, used only to fetch leads for bulk block / unblock. */
export function tokenState(s: Settings) {
  const expiresAt = s.cs_token_expires_at ? new Date(s.cs_token_expires_at) : null;
  const connected = !!s.cs_access_token;
  const expired = !connected || !expiresAt || expiresAt.getTime() <= Date.now();
  return { connected, expired, expiresAt };
}

/** Saves the partner login (rft + st cookies) after the admin's OTP + PIN. */
export async function savePartnerLogin(phone: string, jar: CsJar, expiresAt: Date) {
  await setSettings({
    cs_phone: phone,
    cs_refresh_token: jar.rft ?? "",
    cs_access_token: jar.st ?? "",
    cs_token_expires_at: expiresAt.toISOString(),
  });
}

export interface CsLead {
  client_id: number;
  phone_number?: string;
  user_name?: string;
  signup_date?: string | null;
  days_since_signup?: number;
  last_activity_date?: string | null;
  user_stage?: string;
  kyc_status?: string;
  bank_status?: string;
  deposit_status?: string;
  trade_status?: string;
  lead_source?: string;
}

export interface LeadsPage {
  clients: CsLead[];
  page: number;
  totalPages: number;
  totalLeads: number;
}

/** One page (500 leads) of the affiliate lead list. */
export async function fetchLeadsPage(page: number, s: Settings): Promise<LeadsPage> {
  const t = tokenState(s);
  if (!t.connected) throw new CsError("CoinSwitch isn’t connected. Log in to your partner account in Settings → CoinSwitch.", "not_connected");
  if (t.expired) throw new CsError("The CoinSwitch access token has expired. Log in again in Settings → CoinSwitch.", "expired");

  let res: Response;
  try {
    res = await fetch(`${LEADS_URL}?page=${page}`, {
      headers: { Accept: "application/json", cookie: s.cs_refresh_token ? `rft=${s.cs_refresh_token}; st=${s.cs_access_token}` : `st=${s.cs_access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new CsError(`Could not reach CoinSwitch: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CsError("CoinSwitch rejected the partner login. Log in again in Settings → CoinSwitch.", "expired");
  }
  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    msg?: string;
    data?: { clients?: CsLead[]; total_pages?: number; total_leads?: number; page?: number };
  } | null;
  if (!res.ok || !json || json.success === false || !Array.isArray(json.data?.clients)) {
    throw new CsError(`CoinSwitch lead list failed (HTTP ${res.status})${json?.msg ? `: ${json.msg}` : ""}`);
  }
  return {
    clients: json.data!.clients!,
    page: Number(json.data!.page ?? page),
    totalPages: Math.max(1, Number(json.data!.total_pages ?? 1)),
    totalLeads: Number(json.data!.total_leads ?? json.data!.clients!.length),
  };
}

/** Text that fits a VARCHAR column (MySQL rejects over-long values). */
const clip = (v: unknown, max: number) => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * CoinSwitch documents statuses as strings, but be safe with other shapes:
 * - booleans/numbers become text ("true", "1", "false"…)
 * - an object uses its status/state/value/name field when there is one
 * - an array uses its first item
 * - anything else is kept as JSON text, which isDone() treats as not done
 */
export function normalizeStatus(v: unknown, depth = 0): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return clip(v, 64);
  if (depth < 3 && Array.isArray(v)) return v.length ? normalizeStatus(v[0], depth + 1) : null;
  if (depth < 3 && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["status", "state", "value", "name"]) if (k in o) return normalizeStatus(o[k], depth + 1);
  }
  try {
    return clip(JSON.stringify(v), 64);
  } catch {
    return null;
  }
}

/** ISO text, or a numeric timestamp in seconds or milliseconds. Anything else becomes null. */
const toDate = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : NaN;
  return Number.isFinite(t) && t > 0 ? new Date(t) : null;
};

/** Saves one page of leads into the server-side cache. */
export async function saveLeads(clients: CsLead[]) {
  if (!clients.length) return;
  const rows = clients
    .filter((c) => Number.isFinite(Number(c.client_id)))
    .map((c) => [
      Number(c.client_id),
      typeof c.phone_number === "string" || typeof c.phone_number === "number" ? clip(lastFour(String(c.phone_number)), 8) : null,
      typeof c.user_name === "string" ? clip(c.user_name, 255) : null,
      toDate(c.signup_date),
      toDate(c.last_activity_date),
      normalizeStatus(c.user_stage),
      normalizeStatus(c.kyc_status),
      normalizeStatus(c.bank_status),
      normalizeStatus(c.deposit_status),
      normalizeStatus(c.trade_status),
      typeof c.lead_source === "string" ? clip(c.lead_source, 255) : normalizeStatus(c.lead_source),
    ]);
  await query(
    `INSERT INTO cs_leads (client_id, phone_last4, user_name, signup_date, last_activity_date, user_stage,
       kyc_status, bank_status, deposit_status, trade_status, lead_source)
     VALUES ?
     ON DUPLICATE KEY UPDATE phone_last4 = VALUES(phone_last4), user_name = VALUES(user_name), signup_date = VALUES(signup_date),
       last_activity_date = VALUES(last_activity_date), user_stage = VALUES(user_stage), kyc_status = VALUES(kyc_status),
       bank_status = VALUES(bank_status), deposit_status = VALUES(deposit_status), trade_status = VALUES(trade_status),
       lead_source = VALUES(lead_source), synced_at = CURRENT_TIMESTAMP`,
    [rows]
  );
}

export const markSynced = () => setSettings({ cs_last_sync_at: new Date().toISOString() });

/**
 * A CoinSwitch step counts as complete unless its status is NOT_STARTED, PENDING, *PROGRESS*,
 * a negative value (false / 0 / no / none) or empty.
 */
export function isDone(status: string | null | undefined) {
  const s = status?.trim();
  if (!s) return false;
  if (s.startsWith("{") || s.startsWith("[")) return false; // an unrecognised object/array shape: be cautious
  return !/NOT[_\s-]?STARTED|PENDING|PROGRESS|^(false|0|no|none)$/i.test(s);
}
