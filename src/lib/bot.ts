import "server-only";
import { queryOne } from "./db";
import {
  DeliveryError,
  deliverVideos,
  deliveryBlockReason,
  memberVideos,
  minutesLabel,
  pendingVideoIds,
  setPendingVideos,
  type Member,
  type MemberVideo,
} from "./members";
import type { Settings } from "./settings";
import { tg } from "./telegram";

// Telegram update shapes (only the fields the bot uses).
interface TgUser {
  id: number;
  first_name?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

type InlineKeyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function handleUpdate(u: TgUpdate, s: Settings) {
  if (u.message?.text && u.message.chat.type === "private" && u.message.from) return onMessage(u.message, s);
  if (u.callback_query) return onCallback(u.callback_query, s);
}

const findMember = (telegramId: number) => queryOne<Member>("SELECT * FROM members WHERE telegram_id = ?", [String(telegramId)]);

function send(s: Settings, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg(s.telegram_bot_token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

async function replyNotLinked(s: Settings, chatId: number) {
  const site = s.public_site_url;
  await send(
    s,
    chatId,
    `To get the ${esc(s.site_name)} videos, first verify your Elefin account on our website and connect this Telegram account.`,
    site?.startsWith("https://") ? { reply_markup: { inline_keyboard: [[{ text: "Open the website", url: site }]] } } : {}
  );
}

async function onMessage(msg: TgMessage, s: Settings) {
  const chatId = msg.chat.id;
  const [rawCmd, payload] = msg.text!.trim().split(/\s+/, 2);
  const cmd = rawCmd.toLowerCase().split("@")[0];

  const member = await findMember(msg.from!.id);
  if (!member) return replyNotLinked(s, chatId);
  const block = deliveryBlockReason(member);
  if (block) return send(s, chatId, esc(block));

  if (cmd === "/start") {
    // Videos requested on the website before the user had started the bot: send them now.
    const pending = pendingVideoIds(member);
    if (pending.length) {
      await setPendingVideos(member.id, null);
      await deliverAndReport(member, s, chatId, pending);
      return;
    }
    const name = msg.from!.first_name ? `, ${esc(msg.from!.first_name)}` : "";
    return sendMenu(member, s, chatId, payload === "video" ? undefined : `👋 Welcome${name}!`);
  }
  if (cmd === "/videos") return sendMenu(member, s, chatId);
  return send(s, chatId, "Send /videos to see your mentorship videos.");
}

async function onCallback(cq: TgCallbackQuery, s: Settings) {
  const answer = (text: string, alert = false) =>
    tg(s.telegram_bot_token, "answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert }).catch(() => {});

  const member = await findMember(cq.from.id);
  if (!member) return answer("Verify your Elefin account on the website first.", true);
  const block = deliveryBlockReason(member);
  if (block) return answer(block, true);

  const m = cq.data?.match(/^get:(all|\d+)$/);
  if (!m) return answer("");
  const ids = m[1] === "all" ? undefined : [Number(m[1])];
  await answer(ids ? "Sending your video…" : "Sending your videos…");

  await deliverAndReport(member, s, cq.from.id, ids);
  // Refresh the list so statuses and buttons reflect what was just sent.
  if (cq.message) {
    const fresh = (await findMember(cq.from.id)) ?? member;
    const menu = await buildMenu(fresh, s);
    await tg(s.telegram_bot_token, "editMessageText", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: menu.text,
      parse_mode: "HTML",
      reply_markup: menu.keyboard,
    }).catch(() => {}); // "message is not modified" is fine
  }
}

/** Delivers videos and tells the user about anything that was skipped or failed. */
async function deliverAndReport(member: Member, s: Settings, chatId: number, videoIds?: number[]) {
  try {
    const report = await deliverVideos(member, s, { videoIds });
    const notes = report.results
      .filter((r) => !r.ok)
      .map((r) => `• ${esc(r.title)}: ${esc(r.skipped ? (r.error ?? "Not available") : "couldn't be sent, please try again later")}`);
    if (notes.length) await send(s, chatId, `Some videos weren't sent:\n${notes.join("\n")}`);
  } catch (e) {
    if (e instanceof DeliveryError) {
      if (e.code === "need_start") return; // Can't message them at all; nothing more we can do here.
      return send(s, chatId, esc(e.message)).catch(() => {});
    }
    console.error("Bot delivery failed:", e);
    await send(s, chatId, "Sorry, something went wrong. Please try again in a moment.").catch(() => {});
  }
}

function statusLabel(v: MemberVideo) {
  if (v.status === "sent") return "✅ sent";
  if (v.status === "cooldown") return `⏳ in ${minutesLabel(v.availableAt!.getTime() - Date.now())}`;
  return v.lastSentAt ? "🔁 available again" : "🆕 available";
}

async function buildMenu(member: Member, s: Settings): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const videos = await memberVideos(member, s);
  if (!videos.length) return { text: "No videos are available yet. Please check back later.", keyboard: { inline_keyboard: [] } };

  const lines = videos.map((v, i) => `${i + 1}. ${esc(v.title)} — ${statusLabel(v)}`);
  const available = videos.filter((v) => v.status === "available");
  const rows: InlineKeyboard["inline_keyboard"] = available.map((v) => [{ text: `▶ ${trim(v.title, 48)}`, callback_data: `get:${v.id}` }]);
  if (available.length > 1) rows.push([{ text: `📥 Get all (${available.length})`, callback_data: "get:all" }]);

  const footer = available.length ? "Tap a video to receive it here." : "Nothing new to send right now.";
  return { text: `<b>Your mentorship videos</b>\n\n${lines.join("\n")}\n\n${footer}`, keyboard: { inline_keyboard: rows } };
}

async function sendMenu(member: Member, s: Settings, chatId: number, greeting?: string) {
  const menu = await buildMenu(member, s);
  await send(s, chatId, greeting ? `${greeting}\n\n${menu.text}` : menu.text, { reply_markup: menu.keyboard });
}
