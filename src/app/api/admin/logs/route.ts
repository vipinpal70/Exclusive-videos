import { adminRoute, json } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const GET = adminRoute(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "lookups" ? "lookups" : "deliveries";
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  if (type === "lookups") {
    const w = q ? "WHERE email LIKE ? OR ip = ?" : "";
    const p = q ? [`%${q}%`, q] : [];
    const total = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM lookup_logs ${w}`, p);
    const rows = await query(`SELECT * FROM lookup_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
    return json({ ok: true, rows, total: Number(total?.c ?? 0), pages: Math.max(1, Math.ceil(Number(total?.c ?? 0) / limit)) });
  }

  const w = q ? "WHERE m.email LIKE ? OR m.telegram_username LIKE ? OR v.title LIKE ?" : "";
  const p = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const total = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM deliveries d LEFT JOIN members m ON m.id = d.member_id LEFT JOIN videos v ON v.id = d.video_id ${w}`,
    p
  );
  const rows = await query(
    `SELECT d.*, m.email, m.telegram_username, v.title FROM deliveries d
     LEFT JOIN members m ON m.id = d.member_id LEFT JOIN videos v ON v.id = d.video_id ${w}
     ORDER BY d.id DESC LIMIT ? OFFSET ?`,
    [...p, limit, offset]
  );
  return json({ ok: true, rows, total: Number(total?.c ?? 0), pages: Math.max(1, Math.ceil(Number(total?.c ?? 0) / limit)) });
});
