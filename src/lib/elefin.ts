import "server-only";
import { bool, getSettings, num, type Settings } from "./settings";

export interface ElefinClient {
  affiliated: boolean;
  client_id: number;
  name: string;
  email: string;
  country: string;
  status: string;
  registered_at: string;
  referred_at: string;
  referral_code: string;
  funding?: {
    currency: string;
    deposits: number;
    withdrawals: number;
    net_deposit: number;
    deposit_count: number;
    is_funded: boolean;
  };
  accounts?: { count: number; logins: string[]; balance: number; equity: number };
  trading?: { lots: number; trades: number; last_trade_at: string | null };
  commission_earned?: number;
}

export type LookupResult =
  | { found: true; client: ElefinClient; raw: unknown }
  | { found: false; message: string; raw: unknown };

export class ElefinError extends Error {}

export async function lookupClient(email: string, settings?: Settings): Promise<LookupResult> {
  const s = settings ?? (await getSettings());
  const base = (s.elefin_api_base || "").replace(/\/+$/, "");
  if (!base) throw new ElefinError("Elefin API base URL is not configured");
  if (!s.elefin_api_token) throw new ElefinError("Elefin API token is not configured");

  const url = `${base}/clients/lookup?email=${encodeURIComponent(email)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${s.elefin_api_token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new ElefinError(`Could not reach Elefin API: ${e instanceof Error ? e.message : e}`);
  }

  let body: { success?: boolean; message?: string; data?: ElefinClient } | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }

  if (res.status === 401 || res.status === 403) throw new ElefinError(`Elefin API rejected the token (HTTP ${res.status})`);
  if (res.status === 404 || (body && body.success === false) || (res.ok && !body?.data)) {
    return { found: false, message: body?.message || "Client not found", raw: body };
  }
  if (!res.ok) throw new ElefinError(`Elefin API error HTTP ${res.status}: ${body?.message ?? ""}`.trim());

  return { found: true, client: body!.data!, raw: body };
}

export interface Eligibility {
  eligible: boolean;
  reason: string | null;
  lots: number;
  minLots: number;
}

export function checkEligibility(client: ElefinClient, s: Settings): Eligibility {
  const lots = Number(client.trading?.lots ?? 0);
  const minLots = num(s.min_lots);
  const base = { lots, minLots };

  if (bool(s.require_affiliated) && !client.affiliated)
    return { ...base, eligible: false, reason: "Your Elefin account is not registered under our partner link." };
  if (bool(s.require_active) && client.status !== "active")
    return { ...base, eligible: false, reason: `Your Elefin account status is "${client.status}". It must be active.` };
  const minDep = num(s.min_net_deposit);
  if (minDep > 0 && Number(client.funding?.net_deposit ?? 0) < minDep)
    return { ...base, eligible: false, reason: `A minimum net deposit of $${minDep} is required.` };
  if (lots < minLots)
    return { ...base, eligible: false, reason: `You have traded ${lots} lots. At least ${minLots} lots are required.` };

  return { ...base, eligible: true, reason: null };
}
