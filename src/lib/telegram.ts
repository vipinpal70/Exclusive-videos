import "server-only";

export class TelegramError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export async function tg<T = unknown>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!token) throw new TelegramError("Telegram bot token is not configured");
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new TelegramError(`Could not reach Telegram: ${e instanceof Error ? e.message : e}`);
  }
  const body = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }
    | null;
  if (!body?.ok) {
    // Respect flood control once.
    const retry = body?.parameters?.retry_after;
    if (body?.error_code === 429 && retry && retry <= 10) {
      await new Promise((r) => setTimeout(r, retry * 1000));
      return tg<T>(token, method, params);
    }
    throw new TelegramError(body?.description || `Telegram HTTP ${res.status}`, body?.error_code);
  }
  return body.result as T;
}

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
}

export const getMe = (token: string) => tg<BotInfo>(token, "getMe");

/**
 * Parses a Telegram message link.
 *  https://t.me/c/1234567890/45         -> private channel -1001234567890, message 45
 *  https://t.me/c/1234567890/12/45      -> topic message
 *  https://t.me/channelname/45          -> public channel @channelname
 */
export function parseMessageLink(link: string): { chatId: string; messageId: number } | null {
  const m = link.trim().match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/(.+)$/i);
  if (!m) return null;
  const parts = m[1].split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts[0] === "c" && parts.length >= 3) {
    const internal = parts[1];
    const msg = Number(parts[parts.length - 1]);
    if (!/^\d+$/.test(internal) || !Number.isInteger(msg)) return null;
    return { chatId: `-100${internal}`, messageId: msg };
  }
  if (parts.length >= 2 && /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(parts[0])) {
    const msg = Number(parts[parts.length - 1]);
    if (!Number.isInteger(msg)) return null;
    return { chatId: `@${parts[0]}`, messageId: msg };
  }
  return null;
}

export interface VerifyResult {
  ok: boolean;
  message: string;
  chatTitle?: string;
  chatId?: string;
}

/** Checks that the bot is an admin in the source channel and is allowed to copy messages from it. */
export async function verifyVideoSource(token: string, chatId: string, messageId: number, testChatId?: string): Promise<VerifyResult> {
  const me = await getMe(token);
  let chat: { id: number; title?: string; type: string };
  try {
    chat = await tg(token, "getChat", { chat_id: chatId });
  } catch (e) {
    return { ok: false, message: `Bot cannot access the channel: ${(e as Error).message}. Add @${me.username} to the channel as an admin.` };
  }

  let member: { status: string; can_post_messages?: boolean };
  try {
    member = await tg(token, "getChatMember", { chat_id: chat.id, user_id: me.id });
  } catch (e) {
    return { ok: false, chatTitle: chat.title, message: `Could not read bot membership: ${(e as Error).message}` };
  }
  if (member.status !== "administrator" && member.status !== "creator") {
    return { ok: false, chatTitle: chat.title, chatId: String(chat.id), message: `@${me.username} is "${member.status}" in "${chat.title}". It must be an administrator.` };
  }
  if (testChatId) {
    try {
      const sent = await tg<{ message_id: number }>(token, "copyMessage", {
        chat_id: testChatId,
        from_chat_id: chat.id,
        message_id: messageId,
        disable_notification: true,
      });
      return { ok: true, chatTitle: chat.title, chatId: String(chat.id), message: `Bot is admin and a test copy was sent to ${testChatId} (message #${sent.message_id}).` };
    } catch (e) {
      return { ok: false, chatTitle: chat.title, chatId: String(chat.id), message: `Bot is admin, but copying message #${messageId} failed: ${(e as Error).message}` };
    }
  }

  return { ok: true, chatTitle: chat.title, chatId: String(chat.id), message: `@${me.username} is an administrator in "${chat.title}". Set a test chat ID in settings to also confirm the message itself.` };
}
