import { adminRoute, fail, json } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import type { Video } from "@/lib/members";
import { parseMessageLink } from "@/lib/telegram";
import { verifyAndSave } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = adminRoute<Ctx>(async (req, { params }) => {
  const id = Number((await params).id);
  const video = await queryOne<Video>("SELECT * FROM videos WHERE id = ?", [id]);
  if (!video) return fail("Video not found.", 404);

  const body = await req.json().catch(() => ({}));
  const title = body.title !== undefined ? String(body.title).trim() : video.title;
  if (!title) return fail("Title is required.");
  const caption = body.caption !== undefined ? String(body.caption) || null : video.caption;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : video.is_active;

  let link = video.link;
  let chatId = video.from_chat_id;
  let messageId = Number(video.message_id);
  const linkChanged = body.link !== undefined && String(body.link).trim() !== video.link;
  if (linkChanged) {
    const parsed = parseMessageLink(String(body.link));
    if (!parsed) return fail("Invalid Telegram message link.");
    link = String(body.link).trim();
    chatId = parsed.chatId;
    messageId = parsed.messageId;
  }

  await execute(
    `UPDATE videos SET title = ?, caption = ?, is_active = ?, link = ?, from_chat_id = ?, message_id = ?
       ${linkChanged ? ", verify_status = 'unverified', verify_message = NULL, chat_title = NULL" : ""} WHERE id = ?`,
    [title, caption, isActive, link, chatId, messageId, id]
  );
  const verify = linkChanged ? await verifyAndSave(id, chatId, messageId) : null;
  return json({ ok: true, verify });
}, "videos.manage");

export const DELETE = adminRoute<Ctx>(async (_req, { params }) => {
  const id = Number((await params).id);
  await execute("DELETE FROM videos WHERE id = ?", [id]);
  return json({ ok: true });
}, "videos.manage");

/** POST = re-run verification */
export const POST = adminRoute<Ctx>(async (_req, { params }) => {
  const id = Number((await params).id);
  const video = await queryOne<Video>("SELECT * FROM videos WHERE id = ?", [id]);
  if (!video) return fail("Video not found.", 404);
  const verify = await verifyAndSave(id, video.from_chat_id, Number(video.message_id));
  if (!verify) return fail("Set the Telegram bot token in Settings first.");
  return json({ ok: true, verify });
}, "videos.manage");
