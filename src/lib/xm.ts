import "server-only";
import { bool, getSettings, num, type Settings } from "./settings";

/*
 * XM partners API (https://mypartners.xm.com/api), authenticated with "Authorization: Bearer <token>".
 * - GET /traders/{loginId}                      one account: is it under our affiliation? (404 = no)
 * - GET /trader-statistics/trades?startTime&endTime[&traderIds=1,2,3]
 *                                               trades of our clients; at most 93 days per request
 * - GET /trader-balance?traderIds=1,2,3         balance above/below the threshold XM set for us
 * XM does not expose emails or deposit history.
 */

export class XmError extends Error {}

export interface XmTrader {
  loginId: number;
  serverName?: string;
  accountType?: string;
  signupDate?: string;
  activationDate?: string;
  campaignId?: number;
  campaignName?: string;
  archived: boolean;
  validated: boolean;
}

interface XmTrade {
  loginId: number;
  lots: number;
  openTime?: string;
  closeTime?: string;
}

/** XM allows at most this many days between startTime and endTime. */
const MAX_WINDOW_DAYS = 92;
/** Trader IDs per trades/balance request, to keep URLs short and responses small. */
export const XM_IDS_PER_REQUEST = 50;
/** Longest activity window we query (several 93-day requests). */
export const XM_MAX_DAYS = 365;

export const isLoginId = (v: string) => /^\d{5,12}$/.test(v);

async function xmGet<T>(s: Settings, path: string): Promise<{ status: number; body: T | null }> {
  const base = (s.xm_api_base || "https://mypartners.xm.com/api").replace(/\/+$/, "");
  if (!s.xm_api_token) throw new XmError("XM API token is not configured");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${s.xm_api_token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new XmError(`Could not reach XM API: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 401 && path.startsWith("/trader-statistics")) throw new XmError("XM API rejected the token (HTTP 401)");
  const body = res.ok ? ((await res.json().catch(() => null)) as T | null) : null;
  return { status: res.status, body };
}

/** One account. Returns null when it isn't under our affiliation (XM answers 401/404). */
export async function lookupXmTrader(loginId: string, s: Settings): Promise<XmTrader | null> {
  const r = await xmGet<XmTrader>(s, `/traders/${encodeURIComponent(loginId)}`);
  if (r.status === 404 || r.status === 401) return null;
  if (r.status !== 200 || !r.body) throw new XmError(`XM trader lookup failed (HTTP ${r.status})`);
  return r.body;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** XM timestamps have no timezone; treat them as UTC. */
const parseXmTime = (t?: string) => (t ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`) : NaN);

export interface XmActivity {
  /** Most recent trade (close time, else open time) within the window, as ISO, or null. */
  lastTradeAt: string | null;
  lots: number;
  trades: number;
}

/**
 * Trading activity of the given accounts over the last `days` days (max 365), split into
 * 93-day requests of up to 50 accounts each. Accounts with no trades get { lastTradeAt: null, lots: 0 }.
 */
export async function xmActivity(loginIds: string[], days: number, s: Settings): Promise<Record<string, XmActivity>> {
  const span = Math.min(Math.max(1, Math.floor(days)), XM_MAX_DAYS);
  const out: Record<string, XmActivity> = {};
  for (const id of loginIds) out[id] = { lastTradeAt: null, lots: 0, trades: 0 };
  if (!loginIds.length) return out;

  const end = new Date();
  const earliest = new Date(end.getTime() - span * 86_400_000);
  for (let i = 0; i < loginIds.length; i += XM_IDS_PER_REQUEST) {
    const ids = loginIds.slice(i, i + XM_IDS_PER_REQUEST);
    let windowEnd = end;
    while (windowEnd > earliest) {
      const windowStart = new Date(Math.max(earliest.getTime(), windowEnd.getTime() - MAX_WINDOW_DAYS * 86_400_000));
      const q = `startTime=${ymd(windowStart)}&endTime=${ymd(windowEnd)}&traderIds=${ids.join(",")}`;
      const r = await xmGet<XmTrade[]>(s, `/trader-statistics/trades?${q}`);
      if (r.status === 404) {
        // No trades found for these accounts in this window.
      } else if (r.status !== 200 || !Array.isArray(r.body)) {
        throw new XmError(`XM trade statistics failed (HTTP ${r.status})`);
      } else {
        for (const t of r.body) {
          const a = out[String(t.loginId)];
          if (!a) continue;
          const when = parseXmTime(t.closeTime) || parseXmTime(t.openTime);
          if (Number.isFinite(when) && when < earliest.getTime()) continue; // day-granular API; trim to the exact window
          a.trades++;
          a.lots += Number(t.lots) || 0;
          if (Number.isFinite(when) && (!a.lastTradeAt || when > Date.parse(a.lastTradeAt))) a.lastTradeAt = new Date(when).toISOString();
        }
      }
      windowEnd = new Date(windowStart.getTime() - 86_400_000);
    }
  }
  for (const a of Object.values(out)) a.lots = Math.round(a.lots * 100) / 100;
  return out;
}

/** Balance-over-threshold flags for the given accounts (accounts XM doesn't return are omitted). */
export async function xmBalances(loginIds: string[], s: Settings): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (let i = 0; i < loginIds.length; i += XM_IDS_PER_REQUEST) {
    const ids = loginIds.slice(i, i + XM_IDS_PER_REQUEST);
    const r = await xmGet<{ loginId: number; balanceOverThreshold: boolean }[]>(s, `/trader-balance?traderIds=${ids.join(",")}`);
    if (r.status === 404 || r.status === 401) continue;
    if (r.status !== 200 || !Array.isArray(r.body)) throw new XmError(`XM balance check failed (HTTP ${r.status})`);
    for (const b of r.body) out[String(b.loginId)] = !!b.balanceOverThreshold;
  }
  return out;
}

export interface XmCheck {
  found: boolean;
  trader: XmTrader | null;
  activity: XmActivity;
  balanceOk: boolean | null;
  eligible: boolean;
  reason: string | null;
  minLots: number;
  windowDays: number;
}

/** Full eligibility check for one XM account, using the XM rules from Settings. */
export async function checkXmAccount(loginId: string, settings?: Settings): Promise<XmCheck> {
  const s = settings ?? (await getSettings());
  const minLots = num(s.xm_min_lots);
  const windowDays = Math.min(Math.max(1, num(s.xm_lots_window_days, 90)), XM_MAX_DAYS);
  const empty: XmActivity = { lastTradeAt: null, lots: 0, trades: 0 };
  const base = { minLots, windowDays };

  const trader = await lookupXmTrader(loginId, s);
  // "validated" is XM's affiliation flag: a non-validated account is treated as not under our partner link.
  if (!trader || !trader.validated) {
    return { ...base, found: false, trader: null, activity: empty, balanceOk: null, eligible: false, reason: "This XM account isn’t registered under our partner link." };
  }
  const fail = (reason: string, activity = empty, balanceOk: boolean | null = null): XmCheck => ({
    ...base,
    found: true,
    trader,
    activity,
    balanceOk,
    eligible: false,
    reason,
  });
  if (bool(s.xm_reject_archived) && trader.archived) return fail("This XM account is archived. Please use an active account.");

  const activity = (await xmActivity([loginId], windowDays, s))[loginId] ?? empty;
  let balanceOk: boolean | null = null;
  if (bool(s.xm_require_balance)) {
    balanceOk = (await xmBalances([loginId], s))[loginId] ?? false;
    if (!balanceOk) return fail("Your XM account balance is below the required level.", activity, balanceOk);
  }
  if (activity.lots < minLots) {
    return fail(`You have traded ${activity.lots} lots in the last ${windowDays} days. At least ${minLots} lots are required.`, activity, balanceOk);
  }
  return { ...base, found: true, trader, activity, balanceOk, eligible: true, reason: null };
}
