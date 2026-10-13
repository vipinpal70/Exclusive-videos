import "server-only";

// In-memory limits for CoinSwitch SMS codes (per server process), on top of CoinSwitch's own limits.
const PER_PHONE_GAP_MS = 30_000;
const PER_IP_WINDOW_MS = 10 * 60_000;
const PER_IP_MAX = 5;

const lastByPhone = new Map<string, number>();
const sendsByIp = new Map<string, number[]>();

export function canSendCsOtp(ip: string, phone: string): { ok: true } | { ok: false; error: string; retryAfter: number } {
  const now = Date.now();
  const last = lastByPhone.get(phone) ?? 0;
  if (now - last < PER_PHONE_GAP_MS) {
    const retryAfter = Math.ceil((PER_PHONE_GAP_MS - (now - last)) / 1000);
    return { ok: false, error: `Please wait ${retryAfter} seconds before requesting another code.`, retryAfter };
  }
  const recent = (sendsByIp.get(ip) ?? []).filter((t) => now - t < PER_IP_WINDOW_MS);
  if (recent.length >= PER_IP_MAX) {
    const retryAfter = Math.ceil((PER_IP_WINDOW_MS - (now - recent[0])) / 1000);
    return { ok: false, error: "Too many codes requested. Please wait a few minutes.", retryAfter };
  }
  recent.push(now);
  sendsByIp.set(ip, recent);
  lastByPhone.set(phone, now);
  if (lastByPhone.size > 5000) for (const [k, t] of lastByPhone) if (now - t > PER_PHONE_GAP_MS) lastByPhone.delete(k);
  if (sendsByIp.size > 5000) for (const [k, ts] of sendsByIp) if (ts.every((t) => now - t > PER_IP_WINDOW_MS)) sendsByIp.delete(k);
  return { ok: true };
}
