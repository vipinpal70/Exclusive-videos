import "server-only";
import { queryOne } from "./db";
import {
  DeliveryError,
  deliverVideos,
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

type Button = { text: string; callback_data?: string; url?: string };
type InlineKeyboard = { inline_keyboard: Button[][] };
interface Screen {
  text: string;
  keyboard: InlineKeyboard;
}

/** Lesson buttons per page in the video list. */
const PAGE_SIZE = 10;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Compact time for buttons: "45m", "2h 5m", "3d 4h". */
function shortWait(ms: number) {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export async function handleUpdate(u: TgUpdate, s: Settings) {
  if (u.message?.text && u.message.chat.type === "private" && u.message.from) return onMessage(u.message, s);
  if (u.callback_query) return onCallback(u.callback_query, s);
}

const findMember = (telegramId: number) => queryOne<Member>("SELECT * FROM members WHERE telegram_id = ?", [String(telegramId)]);

function send(s: Settings, chatId: number, screen: Screen) {
  return tg(s.telegram_bot_token, "sendMessage", {
    chat_id: chatId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: screen.keyboard,
  });
}

/** Replaces an existing bot message with a new screen ("message is not modified" is ignored). */
function edit(s: Settings, chatId: number, messageId: number, screen: Screen) {
  return tg(s.telegram_bot_token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: screen.keyboard,
  }).catch(() => {});
}

const httpsUrl = (u: string | undefined) => (u && /^https:\/\//i.test(u) ? u : null);

/* ---------------- Screens ---------------- */

function notLinkedScreen(s: Settings): Screen {
  const site = httpsUrl(s.public_site_url);
  return {
    text: `To get the ${esc(s.site_name)} videos, first verify your Elefin account on our website and connect this Telegram account.`,
    keyboard: { inline_keyboard: site ? [[{ text: "🌐 Open the website", url: site }]] : [] },
  };
}

/** Status screen for a linked member: eligible (with a Get videos button), blocked, or not eligible. */
function statusScreen(m: Member, s: Settings, greeting?: string): Screen {
  const support = httpsUrl(s.support_url);
  const supportRow = support ? [[{ text: "💬 Contact support", url: support }]] : [];
  const hello = greeting ? `${greeting}\n\n` : "";

  if (m.is_blocked) {
    return {
      text: `${hello}⛔ <b>Your access is blocked.</b>\n\nYour Telegram is linked to <b>${esc(m.email)}</b>, but this account can’t receive the mentorship videos right now. If you think this is a mistake, please contact support.`,
      keyboard: { inline_keyboard: supportRow },
    };
  }
  if (!m.eligible) {
    return {
      text: `${hello}⚠️ <b>Not eligible right now.</b>\n\nYour Telegram is linked to <b>${esc(m.email)}</b>, but the account doesn’t currently meet the requirements for the mentorship videos. Verify again on the website once it does.`,
      keyboard: { inline_keyboard: [...(httpsUrl(s.public_site_url) ? [[{ text: "🌐 Open the website", url: s.public_site_url }]] : []), ...supportRow] },
    };
  }
  return {
    text: `${hello}✅ <b>You’re already linked</b> as <b>${esc(m.email)}</b> and eligible for the mentorship videos.\n\nTap below to see the lessons and get them here.`,
    keyboard: { inline_keyboard: [[{ text: "🎬 Get videos", callback_data: "menu:0" }]] },
  };
}

function lessonButton(v: MemberVideo, page: number): Button {
  const title = trim(v.title, 40);
  if (v.status === "cooldown") return { text: `⏳ ${title} · ${shortWait(v.availableAt!.getTime() - Date.now())}`, callback_data: `v:${v.id}:${page}` };
  if (v.status === "sent") return { text: `✅ ${title}`, callback_data: `v:${v.id}:${page}` };
  return { text: `▶️ ${title}`, callback_data: `v:${v.id}:${page}` };
}

/** Paginated lesson list: one button per lesson (10 per page), Prev/Next, Get all and Back. */
async function videoListScreen(m: Member, s: Settings, requestedPage: number): Promise<Screen> {
  const videos = await memberVideos(m, s);
  const back: Button[] = [{ text: "« Back", callback_data: "home" }];
  if (!videos.length) {
    return { text: "🎬 <b>Your mentorship videos</b>\n\nNo videos are available yet. Please check back later.", keyboard: { inline_keyboard: [back] } };
  }

  const pages = Math.ceil(videos.length / PAGE_SIZE);
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = videos.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const available = videos.filter((v) => v.status === "available").length;

  const rows: Button[][] = slice.map((v) => [lessonButton(v, page)]);
  if (pages > 1) {
    const nav: Button[] = [];
    if (page > 0) nav.push({ text: "‹ Prev", callback_data: `menu:${page - 1}` });
    nav.push({ text: `${page + 1} / ${pages}`, callback_data: `menu:${page}` });
    if (page < pages - 1) nav.push({ text: "Next ›", callback_data: `menu:${page + 1}` });
    rows.push(nav);
  }
  if (available > 1) rows.push([{ text: `📥 Get all available (${available})`, callback_data: `all:${page}` }]);
  rows.push(back);

  const legend = s.allow_redelivery === "1" ? "▶️ available · ⏳ time left until you can get it again" : "▶️ available · ✅ already sent";
  const pageInfo = pages > 1 ? ` (page ${page + 1} of ${pages})` : "";
  return {
    text: `🎬 <b>Your mentorship videos</b>${pageInfo}\n\nTap a lesson to receive it here. ${available ? `${available} available now.` : "Nothing new to get right now."}\n<i>${legend}</i>`,
    keyboard: { inline_keyboard: rows },
  };
}

/* ---------------- Handlers ---------------- */

async function onMessage(msg: TgMessage, s: Settings) {
  const chatId = msg.chat.id;
  const cmd = msg.text!.trim().split(/\s+/)[0].toLowerCase().split("@")[0];

  const member = await findMember(msg.from!.id);
  if (!member) return send(s, chatId, notLinkedScreen(s));

  if (cmd === "/start") {
    // Videos requested on the website before the user had started the bot: send them now.
    const pending = pendingVideoIds(member);
    if (pending.length && !member.is_blocked && member.eligible) {
      await setPendingVideos(member.id, null);
      await deliverAndReport(member, s, chatId, pending);
    }
    const name = msg.from!.first_name ? `, ${esc(msg.from!.first_name)}` : "";
    return send(s, chatId, statusScreen(member, s, `👋 Welcome${name}!`));
  }
  if (cmd === "/videos") {
    if (member.is_blocked || !member.eligible) return send(s, chatId, statusScreen(member, s));
    return send(s, chatId, await videoListScreen(member, s, 0));
  }
  return send(s, chatId, statusScreen(member, s));
}

async function onCallback(cq: TgCallbackQuery, s: Settings) {
  const answer = (text = "", alert = false) =>
    tg(s.telegram_bot_token, "answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert }).catch(() => {});
  const chatId = cq.message?.chat.id ?? cq.from.id;
  const messageId = cq.message?.message_id;
  const show = (screen: Screen) => (messageId ? edit(s, chatId, messageId, screen) : send(s, chatId, screen));

  const member = await findMember(cq.from.id);
  if (!member) {
    await answer("Verify your Elefin account on the website first.", true);
    return show(notLinkedScreen(s));
  }
  if (member.is_blocked || !member.eligible) {
    await answer(member.is_blocked ? "Your access is blocked." : "Your account isn't eligible right now.", true);
    return show(statusScreen(member, s));
  }

  const data = cq.data ?? "";
  let m: RegExpMatchArray | null;

  if (data === "home") {
    await answer();
    return show(statusScreen(member, s));
  }

  if ((m = data.match(/^menu:(\d+)$/))) {
    await answer();
    return show(await videoListScreen(member, s, Number(m[1])));
  }

  // A single lesson. Older list messages used "get:<id>"; treat them the same, on page 0.
  if ((m = data.match(/^v:(\d+):(\d+)$/)) || (m = data.match(/^get:(\d+)$/))) {
    const videoId = Number(m[1]);
    const page = Number(m[2] ?? 0);
    const video = (await memberVideos(member, s)).find((v) => v.id === videoId);
    if (!video) {
      await answer("This video is no longer available.", true);
      return show(await videoListScreen(member, s, page));
    }
    if (video.status === "cooldown") {
      const left = minutesLabel(video.availableAt!.getTime() - Date.now());
      await answer(`⏳ You can get "${trim(video.title, 60)}" again in ${left}.`, true);
      return show(await videoListScreen(member, s, page)); // refresh the countdowns
    }
    if (video.status === "sent") {
      return answer(`✅ You've already received "${trim(video.title, 60)}". Check this chat for it.`, true);
    }
    await answer(`Sending "${trim(video.title, 60)}"…`);
    await deliverAndReport(member, s, chatId, [videoId]);
    return show(await videoListScreen((await findMember(cq.from.id)) ?? member, s, page));
  }

  if ((m = data.match(/^all:(\d+)$/)) || data === "get:all") {
    const page = Number(m?.[1] ?? 0);
    const available = (await memberVideos(member, s)).filter((v) => v.status === "available");
    if (!available.length) {
      await answer("Nothing new to get right now.", true);
      return show(await videoListScreen(member, s, page));
    }
    await answer(`Sending ${available.length} video${available.length === 1 ? "" : "s"}…`);
    await deliverAndReport(member, s, chatId, available.map((v) => v.id));
    return show(await videoListScreen((await findMember(cq.from.id)) ?? member, s, page));
  }

  return answer();
}

/** Delivers videos and tells the user about anything that was skipped or failed. */
async function deliverAndReport(member: Member, s: Settings, chatId: number, videoIds?: number[]) {
  const notify = (text: string) =>
    tg(s.telegram_bot_token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML" }).catch(() => {});
  try {
    const report = await deliverVideos(member, s, { videoIds });
    const notes = report.results
      .filter((r) => !r.ok)
      .map((r) => `• ${esc(r.title)}: ${esc(r.skipped ? (r.error ?? "Not available") : "couldn't be sent, please try again later")}`);
    if (notes.length) await notify(`Some videos weren't sent:\n${notes.join("\n")}`);
  } catch (e) {
    if (e instanceof DeliveryError) {
      if (e.code === "need_start") return; // Can't message them at all; nothing more we can do here.
      return notify(esc(e.message));
    }
    console.error("Bot delivery failed:", e);
    await notify("Sorry, something went wrong. Please try again in a moment.");
  }
}
