import "server-only";
import crypto from "crypto";
import { query, queryOne } from "./db";
import { bool, getSettings, num, setSettings, type Settings } from "./settings";

/*
 * CoinSwitch affiliate leads API.
 * Login (auth.coinswitch.co): 1) send OTP to the admin's phone  2) verify OTP → refresh_token
 *                             3) verify PIN with the refresh token → 24-hour access_token (JWT)
 * Leads (coinswitch.co): GET /pro/api/v1/affiliate/leads?page=N, 500 per page from page 0,
 *                        authenticated with the access token in the "st" cookie.
 * Leads carry no email or full phone number (only the last 4 digits) and there is no single-client
 * lookup, so leads are cached in the cs_leads table and never exposed to the public website.
 */

const AUTH_BASE = "https://auth.coinswitch.co/auth/api/v1";
const LEADS_URL = "https://coinswitch.co/pro/api/v1/affiliate/leads";

export class CsError extends Error {
  constructor(
    message: string,
    public code?: "expired" | "not_connected"
  ) {
    super(message);
  }
}

const appHeaders = () => ({
  "Content-Type": "application/json",
  "x-app-version": "6.10.0",
  "x-user-platform": "android",
  "x-request-id": crypto.randomUUID(),
});

async function authCall<T>(path: string, body: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { ...appHeaders(), ...extra },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new CsError(`Could not reach CoinSwitch: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; msg?: string; message?: string; data?: T } | null;
  if (!res.ok || json?.success === false) {
    throw new CsError(json?.msg || json?.message || `CoinSwitch returned HTTP ${res.status}`);
  }
  return (json?.data ?? {}) as T;
}

/** Normalises a phone number to "+<digits>"; numbers without a country code are treated as Indian (+91). */
export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (input.trim().startsWith("+")) return `+${digits}`;
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}
export const lastFour = (phone: string) => phone.replace(/\D/g, "").slice(-4);

/** Step 1: CoinSwitch sends an SMS OTP to the admin's registered phone. */
export async function sendLoginOtp(phone: string) {
  await authCall("/init/auth", { phone_number: normalizePhone(phone), entity_type: "SMS" });
}

/** Step 2: OTP → refresh token. */
export async function verifyLoginOtp(phone: string, otp: string) {
  const data = await authCall<{ refresh_token?: string }>("/verify/auth", {
    phone_number: normalizePhone(phone),
    proof: otp.trim(),
    referral_additional_data: {},
  });
  if (!data.refresh_token) throw new CsError("CoinSwitch didn’t return a refresh token. Please start again.");
  return data.refresh_token;
}

/** Step 3: refresh token + PIN → 24-hour access token. */
export async function verifyLoginPin(refreshToken: string, pin: string) {
  const data = await authCall<{ access_token?: string }>("/verify/pin", { pin: pin.trim() }, { "x-refresh-token": refreshToken });
  if (!data.access_token) throw new CsError("CoinSwitch didn’t return an access token.");
  return data.access_token;
}

/** Expiry from the JWT's exp claim; falls back to 24 hours from now. */
export function tokenExpiry(jwt: string): Date {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return new Date(payload.exp * 1000);
  } catch {
    /* not a readable JWT */
  }
  return new Date(Date.now() + 24 * 3600_000);
}

export function tokenState(s: Settings) {
  const expiresAt = s.cs_token_expires_at ? new Date(s.cs_token_expires_at) : null;
  const connected = !!s.cs_access_token;
  const expired = !connected || !expiresAt || expiresAt.getTime() <= Date.now();
  return { connected, expired, expiresAt };
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
  if (!t.connected) throw new CsError("CoinSwitch isn’t connected. Get an access token in Settings → CoinSwitch.", "not_connected");
  if (t.expired) throw new CsError("The CoinSwitch access token has expired. Get a new one in Settings → CoinSwitch.", "expired");

  let res: Response;
  try {
    res = await fetch(`${LEADS_URL}?page=${page}`, {
      headers: { Accept: "application/json", cookie: `st=${s.cs_access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new CsError(`Could not reach CoinSwitch: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CsError("CoinSwitch rejected the access token. Get a new one in Settings → CoinSwitch.", "expired");
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

// One background sync at a time per server process.
let running: Promise<boolean> | null = null;

/**
 * Re-reads the lead list from page 0 into the cache. With `untilClientId`, stops as soon as that
 * client has been seen (new sign-ups usually appear early). Returns whether that client was found.
 */
export function syncLeads(s: Settings, untilClientId?: number): Promise<boolean> {
  if (running) return running.then(async () => (untilClientId ? !!(await cachedLead(untilClientId)) : true));
  running = (async () => {
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const r = await fetchLeadsPage(page, s);
      totalPages = r.totalPages;
      await saveLeads(r.clients);
      if (untilClientId && r.clients.some((c) => Number(c.client_id) === untilClientId)) return true;
      page++;
    }
    await markSynced();
    return untilClientId ? !!(await cachedLead(untilClientId)) : true;
  })().finally(() => {
    running = null;
  });
  return running;
}

export interface CachedLead {
  client_id: string;
  phone_last4: string | null;
  user_name: string | null;
  signup_date: Date | null;
  last_activity_date: Date | null;
  user_stage: string | null;
  kyc_status: string | null;
  bank_status: string | null;
  deposit_status: string | null;
  trade_status: string | null;
  synced_at: Date;
}

export const cachedLead = (clientId: number) => queryOne<CachedLead>("SELECT * FROM cs_leads WHERE client_id = ?", [clientId]);

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

export interface CsCheck {
  found: boolean;
  phoneMatches: boolean;
  lead: CachedLead | null;
  eligible: boolean;
  reason: string | null;
}

/**
 * Checks one client against the cached leads, refreshing from CoinSwitch when the client isn't
 * cached yet and the cache is older than the configured interval.
 */
export async function checkCsClient(clientId: number, phone: string, settings?: Settings): Promise<CsCheck> {
  const s = settings ?? (await getSettings());
  let lead = await cachedLead(clientId);
  if (!lead) {
    const lastSync = s.cs_last_sync_at ? Date.parse(s.cs_last_sync_at) : 0;
    const maxAge = Math.max(1, num(s.cs_cache_minutes, 15)) * 60_000;
    if (Date.now() - lastSync > maxAge || !s.cs_last_sync_at) {
      await syncLeads(s, clientId);
      lead = await cachedLead(clientId);
    }
  }
  // Same answer for "unknown client ID" and "phone doesn't match", so client IDs can't be probed.
  const notFound = {
    found: false,
    phoneMatches: false,
    lead: null,
    eligible: false,
    reason: "We couldn’t find a CoinSwitch account in our referrals with this client ID and phone number.",
  };
  if (!lead || !lead.phone_last4 || lead.phone_last4 !== lastFour(phone)) return notFound;

  const missing: string[] = [];
  if (bool(s.cs_require_kyc) && !isDone(lead.kyc_status)) missing.push("complete KYC");
  if (bool(s.cs_require_bank) && !isDone(lead.bank_status)) missing.push("add a bank account");
  if (bool(s.cs_require_deposit) && !isDone(lead.deposit_status)) missing.push("make a deposit");
  if (bool(s.cs_require_trade) && !isDone(lead.trade_status)) missing.push("make a trade");
  const reason = missing.length
    ? `To unlock the videos, please ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]} on CoinSwitch.`
    : null;
  return { found: true, phoneMatches: true, lead, eligible: !reason, reason };
}
