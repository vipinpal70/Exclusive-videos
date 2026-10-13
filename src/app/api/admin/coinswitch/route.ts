import { adminRoute, json } from "@/lib/auth";
import { tokenState } from "@/lib/coinswitch";
import { query, queryOne } from "@/lib/db";
import { getSettings } from "@/lib/settings";

/** CoinSwitch connection status for the admin panel: token expiry, cached leads and the status values seen. */
export const GET = adminRoute(async () => {
  const s = await getSettings();
  const t = tokenState(s);
  const count = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM cs_leads");
  // Distinct status values, so admins can see what CoinSwitch actually sends for each step.
  const statuses = await query<{ field: string; value: string | null; n: number }>(
    `SELECT 'kyc' AS field, kyc_status AS value, COUNT(*) AS n FROM cs_leads GROUP BY kyc_status
     UNION ALL SELECT 'bank', bank_status, COUNT(*) FROM cs_leads GROUP BY bank_status
     UNION ALL SELECT 'deposit', deposit_status, COUNT(*) FROM cs_leads GROUP BY deposit_status
     UNION ALL SELECT 'trade', trade_status, COUNT(*) FROM cs_leads GROUP BY trade_status`
  );
  return json({
    ok: true,
    connected: t.connected,
    expired: t.expired,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    phone: s.cs_phone || "",
    leadsCached: Number(count?.c ?? 0),
    lastSyncAt: s.cs_last_sync_at || null,
    statuses: statuses.map((r) => ({ field: r.field, value: r.value ?? "(empty)", count: Number(r.n) })),
  });
});
