import { adminRoute, fail, json } from "@/lib/auth";
import { execute, query, queryOne } from "@/lib/db";
import type { Video } from "@/lib/members";
import { parseMessageLink } from "@/lib/telegram";
import { verifyAndSave } from "@/lib/videos";

export const GET = adminRoute(async () => {
  const videos = await query<Video & { sent_count: number }>(
    `SELECT v.*, (SELECT COUNT(*) FROM deliveries d WHERE d.video_id = v.id AND d.status = 'sent') AS sent_count
     FROM videos v ORDER BY v.sort_order ASC, v.id ASC`
  );
  return json({ ok: true, videos });
});

export const POST = adminRoute(async (req) => {
  const { title, link, caption, is_active } = await req.json().catch(() => ({}));
  if (!String(title ?? "").trim()) return fail("Title is required.");
  const parsed = parseMessageLink(String(link ?? ""));
  if (!parsed) return fail("Invalid Telegram message link. Use e.g. https://t.me/c/1234567890/45");

  const max = await queryOne<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM videos");
  const r = await execute(
    "INSERT INTO videos (title, link, from_chat_id, message_id, caption, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [String(title).trim(), String(link).trim(), parsed.chatId, parsed.messageId, caption || null, is_active === false ? 0 : 1, Number(max?.m ?? 0) + 1]
  );

  // Verify right away so the admin sees permission problems immediately.
  const verify = await verifyAndSave(r.insertId, parsed.chatId, parsed.messageId);
  return json({ ok: true, id: r.insertId, verify });
}, "videos.manage");
