import { adminRoute, json } from "@/lib/auth";
import { query } from "@/lib/db";

/** Cached lead data for this site's CoinSwitch members only (for bulk block / unblock). */
export const GET = adminRoute(async () => {
  const rows = await query<{
    client_id: string;
    last_activity_date: Date | null;
    kyc_status: string | null;
    bank_status: string | null;
    deposit_status: string | null;
    trade_status: string | null;
  }>(
    `SELECT l.client_id, l.last_activity_date, l.kyc_status, l.bank_status, l.deposit_status, l.trade_status
     FROM cs_leads l JOIN members m ON m.broker = 'coinswitch' AND m.broker_account_id = CAST(l.client_id AS CHAR)`
  );
  return json({
    ok: true,
    leads: Object.fromEntries(
      rows.map((r) => [
        String(r.client_id),
        {
          lastActivityAt: r.last_activity_date ? new Date(r.last_activity_date).toISOString() : null,
          kyc: r.kyc_status,
          bank: r.bank_status,
          deposit: r.deposit_status,
          trade: r.trade_status,
        },
      ])
    ),
  });
}, "members.manage");
