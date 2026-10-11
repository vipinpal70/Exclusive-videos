import { adminRoute, json } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const GET = adminRoute(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const filter = url.searchParams.get("filter") || "all";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = 25;

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push(
      "(email LIKE ? OR name LIKE ? OR telegram_username LIKE ? OR broker_account_id LIKE ? OR phone LIKE ? OR CAST(elefin_client_id AS CHAR) = ? OR CAST(telegram_id AS CHAR) = ?)"
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q, q);
  }
  if (filter === "eligible") where.push("eligible = 1");
  if (filter === "ineligible") where.push("eligible = 0");
  if (filter === "delivered") where.push("last_delivered_at IS NOT NULL");
  if (filter === "linked") where.push("telegram_id IS NOT NULL");
  if (filter === "blocked") where.push("is_blocked = 1");
  if (filter === "xm") where.push("broker = 'xm'");
  if (filter === "elefin") where.push("broker = 'elefin'");
  if (filter === "coinswitch") where.push("broker = 'coinswitch'");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM members ${w}`, params);
  const members = await query(
    `SELECT id, email, broker, broker_account_id, phone, elefin_client_id, name, country, affiliated, lots, net_deposit, eligible, last_lookup_at, email_verified_at,
            telegram_id, telegram_username, telegram_name, telegram_photo_url, telegram_linked_at, deliveries_count,
            last_delivered_at, is_blocked, created_at
     FROM members ${w} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  return json({ ok: true, members, total: Number(total?.c ?? 0), page, pages: Math.max(1, Math.ceil(Number(total?.c ?? 0) / limit)) });
});
