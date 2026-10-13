import { adminRoute, json } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { tokenState } from "@/lib/coinswitch";

export const GET = adminRoute(async () => {
  const [m, v, d, l, daily, recent, s] = await Promise.all([
    queryOne<Record<string, number>>(
      `SELECT COUNT(*) AS total, SUM(eligible) AS eligible, SUM(telegram_id IS NOT NULL) AS linked,
              SUM(last_delivered_at IS NOT NULL) AS delivered, SUM(is_blocked) AS blocked FROM members`
    ),
    queryOne<Record<string, number>>("SELECT COUNT(*) AS total, SUM(is_active) AS active, SUM(verify_status = 'error') AS errors FROM videos"),
    queryOne<Record<string, number>>(
      "SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'sent' AND created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) AS sent24h FROM deliveries"
    ),
    queryOne<Record<string, number>>(
      "SELECT COUNT(*) AS total, SUM(eligible) AS eligible, SUM(found = 0) AS not_found FROM lookup_logs WHERE created_at > UTC_TIMESTAMP() - INTERVAL 7 DAY"
    ),
    query<{ day: string; lookups: number; eligible: number }>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS lookups, SUM(eligible) AS eligible
       FROM lookup_logs WHERE created_at > UTC_TIMESTAMP() - INTERVAL 14 DAY GROUP BY day ORDER BY day`
    ),
    query(
      `SELECT id, CASE broker WHEN 'xm' THEN CONCAT('XM ', broker_account_id) WHEN 'coinswitch' THEN CONCAT('CoinSwitch ', broker_account_id) ELSE email END AS email, name, lots, telegram_username, last_delivered_at FROM members
       WHERE last_delivered_at IS NOT NULL ORDER BY last_delivered_at DESC LIMIT 8`
    ),
    getSettings(),
  ]);

  const n = (x: unknown) => Number(x ?? 0);
  const cs = tokenState(s);
  return json({
    ok: true,
    members: { total: n(m?.total), eligible: n(m?.eligible), linked: n(m?.linked), delivered: n(m?.delivered), blocked: n(m?.blocked) },
    videos: { total: n(v?.total), active: n(v?.active), errors: n(v?.errors) },
    deliveries: { sent: n(d?.sent), failed: n(d?.failed), sent24h: n(d?.sent24h) },
    lookups7d: { total: n(l?.total), eligible: n(l?.eligible), notFound: n(l?.not_found) },
    daily: daily.map((r) => ({ day: r.day, lookups: n(r.lookups), eligible: n(r.eligible) })),
    recent,
    coinswitch:
      s.cs_enabled === "1" && cs.connected // the partner login only matters once it has been set up (bulk tools)
        ? { connected: cs.connected, expired: cs.expired, expiresAt: cs.expiresAt?.toISOString() ?? null }
        : null,
    setup: {
      elefin: !!(s.elefin_api_base && s.elefin_api_token),
      telegram: !!(s.telegram_bot_token && s.telegram_bot_username),
      email: s.otp_enabled !== "1" || !!(s.resend_api_key && s.resend_from_email),
      otpEnabled: s.otp_enabled === "1",
      videos: n(v?.active) > 0,
    },
  });
});
