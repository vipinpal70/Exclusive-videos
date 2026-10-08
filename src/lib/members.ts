import "server-only";
import { execute, query, queryOne } from "./db";
import type { ElefinClient, Eligibility } from "./elefin";
import { bool, type Settings } from "./settings";
import { tg, TelegramError } from "./telegram";

export interface Member {
  id: number;
  email: string;
  elefin_client_id: string | null;
  name: string | null;
  country: string | null;
  affiliated: number;
  lots: number;
  net_deposit: number;
  eligible: number;
  last_lookup_at: Date | null;
  email_verified_at: Date | null;
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_name: string | null;
  telegram_photo_url: string | null;
  telegram_linked_at: Date | null;
  deliveries_count: number;
  last_delivered_at: Date | null;
  is_blocked: number;
  created_at: Date;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 255;

export function getMember(id: number) {
  return queryOne<Member>("SELECT * FROM members WHERE id = ?", [id]);
}

export async function upsertMemberFromLookup(email: string, client: ElefinClient, elig: Eligibility, raw: unknown): Promise<Member> {
  await execute(
    `INSERT INTO members (email, elefin_client_id, name, country, affiliated, lots, net_deposit, eligible, lookup_json, last_lookup_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE elefin_client_id = VALUES(elefin_client_id), name = VALUES(name), country = VALUES(country),
       affiliated = VALUES(affiliated), lots = VALUES(lots), net_deposit = VALUES(net_deposit), eligible = VALUES(eligible),
       lookup_json = VALUES(lookup_json), last_lookup_at = VALUES(last_lookup_at)`,
    [
      email,
      client.client_id ?? null,
      client.name ?? null,
      client.country ?? null,
      client.affiliated ? 1 : 0,
      elig.lots,
      Number(client.funding?.net_deposit ?? 0),
      elig.eligible ? 1 : 0,
      JSON.stringify(raw),
    ]
  );
  return (await queryOne<Member>("SELECT * FROM members WHERE email = ?", [email]))!;
}

export async function logLookup(email: string, found: boolean, eligible: boolean, lots: number | null, reason: string | null, ip: string) {
  await execute("INSERT INTO lookup_logs (email, found, eligible, lots, reason, ip) VALUES (?, ?, ?, ?, ?, ?)", [
    email,
    found ? 1 : 0,
    eligible ? 1 : 0,
    lots,
    reason?.slice(0, 500) ?? null,
    ip,
  ]);
}

export async function lookupsFromIp(ip: string, minutes: number) {
  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM lookup_logs WHERE ip = ? AND created_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE",
    [ip, minutes]
  );
  return Number(row?.c ?? 0);
}

export interface Video {
  id: number;
  title: string;
  link: string;
  from_chat_id: string;
  message_id: string;
  chat_title: string | null;
  caption: string | null;
  sort_order: number;
  is_active: number;
  verify_status: "unverified" | "ok" | "error";
  verify_message: string | null;
  verified_at: Date | null;
  created_at: Date;
}

export const activeVideos = () => query<Video>("SELECT * FROM videos WHERE is_active = 1 ORDER BY sort_order ASC, id ASC");

export interface DeliveryReport {
  sent: number;
  failed: number;
  results: { videoId: number; title: string; ok: boolean; error?: string }[];
}

/** Checks whether the member may receive videos now. Returns an error message or null. */
export function deliveryBlockReason(m: Member, s: Settings): string | null {
  if (m.is_blocked) return "Your access has been disabled. Please contact support.";
  if (!m.eligible) return "Your account is not eligible.";
  if (!m.telegram_id) return "Connect your Telegram account first.";
  if (m.last_delivered_at) {
    if (!bool(s.allow_redelivery)) return "The videos have already been delivered to your Telegram. Check your chat with the bot.";
    const cooldown = Number(s.redelivery_cooldown_minutes) || 0;
    const nextAt = new Date(m.last_delivered_at).getTime() + cooldown * 60_000;
    if (Date.now() < nextAt) {
      const mins = Math.ceil((nextAt - Date.now()) / 60_000);
      return `Videos were just delivered. You can request them again in ${mins} minute${mins === 1 ? "" : "s"}.`;
    }
  }
  return null;
}

export async function deliverVideos(m: Member, s: Settings): Promise<DeliveryReport> {
  const token = s.telegram_bot_token;
  const chatId = m.telegram_id!;
  const videos = await activeVideos();
  if (!videos.length) throw new Error("No videos are available yet. Please check back later.");

  const protect = bool(s.telegram_protect_content);
  const report: DeliveryReport = { sent: 0, failed: 0, results: [] };

  if (s.telegram_intro_message?.trim()) {
    try {
      await tg(token, "sendMessage", { chat_id: chatId, text: s.telegram_intro_message, parse_mode: "HTML", protect_content: protect });
    } catch (e) {
      // If the very first message fails because the user blocked the bot, abort early with a clear message.
      if (e instanceof TelegramError && e.code === 403) throw new Error("The bot can't message you. Open the bot in Telegram, press Start, then try again.");
    }
  }

  for (const v of videos) {
    const params: Record<string, unknown> = {
      chat_id: chatId,
      from_chat_id: v.from_chat_id,
      message_id: Number(v.message_id),
      protect_content: protect,
    };
    if (v.caption?.trim()) {
      params.caption = v.caption;
      params.parse_mode = "HTML";
    }
    try {
      const res = await tg<{ message_id: number }>(token, "copyMessage", params);
      report.sent++;
      report.results.push({ videoId: v.id, title: v.title, ok: true });
      await execute("INSERT INTO deliveries (member_id, video_id, telegram_id, status, telegram_message_id) VALUES (?, ?, ?, 'sent', ?)", [
        m.id,
        v.id,
        chatId,
        res.message_id,
      ]);
    } catch (e) {
      const msg = (e as Error).message;
      report.failed++;
      report.results.push({ videoId: v.id, title: v.title, ok: false, error: msg });
      await execute("INSERT INTO deliveries (member_id, video_id, telegram_id, status, error) VALUES (?, ?, ?, 'failed', ?)", [
        m.id,
        v.id,
        chatId,
        msg.slice(0, 1000),
      ]);
      if (e instanceof TelegramError && e.code === 403) {
        throw new Error("The bot can't message you. Open the bot in Telegram, press Start, then try again.");
      }
    }
    await new Promise((r) => setTimeout(r, 60)); // stay well under Telegram's per-chat rate limit
  }

  if (report.sent > 0 && s.telegram_outro_message?.trim()) {
    await tg(token, "sendMessage", { chat_id: chatId, text: s.telegram_outro_message, parse_mode: "HTML", protect_content: protect }).catch(() => {});
  }

  if (report.sent > 0) {
    await execute("UPDATE members SET deliveries_count = deliveries_count + 1, last_delivered_at = UTC_TIMESTAMP() WHERE id = ?", [m.id]);
  }
  return report;
}

export function publicMember(m: Member, emailVerified: boolean) {
  return {
    email: m.email,
    name: m.name,
    lots: Number(m.lots),
    eligible: !!m.eligible,
    emailVerified,
    telegram: m.telegram_id
      ? { id: String(m.telegram_id), username: m.telegram_username, name: m.telegram_name, photoUrl: m.telegram_photo_url }
      : null,
    lastDeliveredAt: m.last_delivered_at,
  };
}

export type LinkResult = { ok: true; canMessage: boolean } | { ok: false; error: string };

/** Links a verified Telegram identity to a member, enforcing one Telegram account per email (and vice versa). */
export async function linkTelegram(
  memberId: number,
  tgUser: { id: string; username: string | null; name: string | null; photoUrl: string | null },
  botToken: string
): Promise<LinkResult> {
  const member = await getMember(memberId);
  if (!member) return { ok: false, error: "Account not found. Please start again." };
  if (member.telegram_id && String(member.telegram_id) !== tgUser.id) {
    return { ok: false, error: "This email is already linked to a different Telegram account. Contact support to change it." };
  }
  const other = await queryOne<{ id: number }>("SELECT id FROM members WHERE telegram_id = ? AND id <> ?", [tgUser.id, memberId]);
  if (other) return { ok: false, error: "This Telegram account is already linked to another email." };

  await execute(
    `UPDATE members SET telegram_id = ?, telegram_username = ?, telegram_name = ?, telegram_photo_url = ?,
       telegram_linked_at = COALESCE(telegram_linked_at, UTC_TIMESTAMP()) WHERE id = ?`,
    [tgUser.id, tgUser.username, tgUser.name, tgUser.photoUrl, memberId]
  );

  // Confirm the bot may message this user (granted by the telegram:bot_access scope).
  let canMessage = true;
  try {
    await tg(botToken, "sendChatAction", { chat_id: tgUser.id, action: "typing" });
  } catch {
    canMessage = false;
  }
  return { ok: true, canMessage };
}
