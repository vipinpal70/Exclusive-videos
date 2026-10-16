import { adminRoute, fail } from "@/lib/auth";
import { query } from "@/lib/db";
import { toCsv, toXlsx, type Cell } from "@/lib/export";

export const maxDuration = 60;

interface Row {
  id: number;
  broker: string;
  email: string | null;
  broker_account_id: string | null;
  elefin_client_id: number | string | null;
  phone: string | null;
  name: string | null;
  country: string | null;
  affiliated: number;
  eligible: number;
  lots: string | number;
  net_deposit: string | number;
  email_verified_at: Date | null;
  telegram_id: number | string | null;
  telegram_username: string | null;
  telegram_name: string | null;
  telegram_linked_at: Date | null;
  deliveries_count: number;
  last_delivered_at: Date | null;
  is_blocked: number;
  created_at: Date;
  last_lookup_at: Date | null;
}

const BROKER = { elefin: "Elefin", xm: "XM", coinswitch: "CoinSwitch" } as Record<string, string>;

/** "YYYY-MM-DD HH:MM" in UTC, matching how the database stores times. */
const when = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : null);
const yesNo = (v: number) => (v ? "Yes" : "No");
const text = (v: unknown): Cell => (v === null || v === undefined || v === "" ? null : String(v));

const COLUMNS: [string, (r: Row) => Cell][] = [
  ["ID", (r) => r.id],
  ["Broker", (r) => BROKER[r.broker] ?? r.broker],
  ["Email", (r) => text(r.email)],
  ["XM / CoinSwitch account ID", (r) => text(r.broker_account_id)],
  ["Elefin client ID", (r) => text(r.elefin_client_id)],
  ["Phone", (r) => text(r.phone)],
  ["Name", (r) => text(r.name)],
  ["Country", (r) => text(r.country)],
  ["Affiliated", (r) => yesNo(r.affiliated)],
  ["Eligible", (r) => yesNo(r.eligible)],
  ["Lots", (r) => Number(r.lots)],
  ["Net deposit", (r) => Number(r.net_deposit)],
  ["Email verified", (r) => when(r.email_verified_at)],
  ["Telegram ID", (r) => text(r.telegram_id)],
  ["Telegram username", (r) => text(r.telegram_username)],
  ["Telegram name", (r) => text(r.telegram_name)],
  ["Telegram linked", (r) => when(r.telegram_linked_at)],
  ["Deliveries", (r) => Number(r.deliveries_count)],
  ["Last delivered", (r) => when(r.last_delivered_at)],
  ["Blocked", (r) => yesNo(r.is_blocked)],
  ["Joined", (r) => when(r.created_at)],
  ["Last checked", (r) => when(r.last_lookup_at)],
];

/**
 * Downloads every member as .xlsx or .csv. POST only (with the admin session cookie, which is
 * SameSite=Lax), so the file can't be fetched by just opening a URL or from another site.
 * body: { format: "xlsx" | "csv" }
 */
export const POST = adminRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const format = body.format === "csv" ? "csv" : body.format === "xlsx" ? "xlsx" : null;
  if (!format) return fail("Choose Excel (.xlsx) or CSV.");

  const members = await query<Row>(
    `SELECT id, broker, email, broker_account_id, elefin_client_id, phone, name, country, affiliated, eligible, lots, net_deposit,
       email_verified_at, telegram_id, telegram_username, telegram_name, telegram_linked_at, deliveries_count, last_delivered_at,
       is_blocked, created_at, last_lookup_at
     FROM members ORDER BY id`
  );
  const headers = COLUMNS.map(([h]) => h);
  const rows = members.map((m) => COLUMNS.map(([, get]) => get(m)));
  const stamp = new Date().toISOString().slice(0, 10);

  const file = format === "csv" ? Buffer.from(toCsv(headers, rows), "utf8") : toXlsx("Members", headers, rows);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="members-${stamp}.${format}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, "members.export");
