import "server-only";
import { execute } from "./db";
import { getSettings } from "./settings";
import { verifyVideoSource, type VerifyResult } from "./telegram";

/** Verifies the bot can copy the given message and stores the result on the video row. */
export async function verifyAndSave(id: number, chatId: string, messageId: number): Promise<VerifyResult | null> {
  const s = await getSettings();
  if (!s.telegram_bot_token) return null;
  const v: VerifyResult = await verifyVideoSource(s.telegram_bot_token, chatId, messageId, s.telegram_test_chat_id || undefined).catch(
    (e) => ({ ok: false, message: (e as Error).message })
  );
  await execute(
    `UPDATE videos SET verify_status = ?, verify_message = ?, verified_at = UTC_TIMESTAMP(),
       chat_title = COALESCE(?, chat_title), from_chat_id = COALESCE(?, from_chat_id) WHERE id = ?`,
    [v.ok ? "ok" : "error", v.message.slice(0, 1000), v.chatTitle ?? null, v.chatId ?? null, id]
  );
  return v;
}
