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
  pending_video_ids: string | null;
  delivery_reset_at: Date | null;
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

export type VideoStatus = "available" | "cooldown" | "sent";

export interface MemberVideo {
  id: number;
  title: string;
  status: VideoStatus;
  /** Last successful delivery to this member (since the last admin reset). */
  lastSentAt: Date | null;
  /** When a video in cooldown can be requested again. */
  availableAt: Date | null;
}

export interface DeliveryReport {
  sent: number;
  failed: number;
  skipped: number;
  results: { videoId: number; title: string; ok: boolean; skipped?: boolean; error?: string }[];
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    public code: "need_start" | "nothing_available" | "no_videos",
    /** For need_start: the videos that still need to be sent once the user starts the bot. */
    public pendingIds: number[] = []
  ) {
    super(message);
  }
}

/** Member-level checks (not per video). Returns an error message or null. */
export function deliveryBlockReason(m: Member): string | null {
  if (m.is_blocked) return "Your access has been disabled. Please contact support.";
  if (!m.eligible) return "Your account is not eligible.";
  if (!m.telegram_id) return "Connect your Telegram account first.";
  return null;
}

/** Active videos with this member's per-video availability (re-delivery and cooldown rules apply to each video). */
export async function memberVideos(m: Member, s: Settings): Promise<MemberVideo[]> {
  const videos = await activeVideos();
  const rows = await query<{ video_id: number; last: Date }>(
    `SELECT video_id, MAX(created_at) AS last FROM deliveries
     WHERE member_id = ? AND status = 'sent' AND video_id IS NOT NULL AND (? IS NULL OR created_at > ?)
     GROUP BY video_id`,
    [m.id, m.delivery_reset_at, m.delivery_reset_at]
  );
  const lastSent = new Map(rows.map((r) => [Number(r.video_id), new Date(r.last)]));
  const allowAgain = bool(s.allow_redelivery);
  const cooldownMs = Math.max(0, Number(s.redelivery_cooldown_minutes) || 0) * 60_000;
  const now = Date.now();

  return videos.map((v): MemberVideo => {
    const last = lastSent.get(v.id) ?? null;
    if (!last) return { id: v.id, title: v.title, status: "available", lastSentAt: null, availableAt: null };
    if (!allowAgain) return { id: v.id, title: v.title, status: "sent", lastSentAt: last, availableAt: null };
    const nextAt = last.getTime() + cooldownMs;
    return nextAt > now
      ? { id: v.id, title: v.title, status: "cooldown", lastSentAt: last, availableAt: new Date(nextAt) }
      : { id: v.id, title: v.title, status: "available", lastSentAt: last, availableAt: null };
  });
}

/** Telegram errors that mean the user hasn't started the bot (or blocked it), which pressing Start fixes. */
export function needsBotStart(e: unknown) {
  if (!(e instanceof TelegramError)) return false;
  return e.code === 403 || /chat not found|can't initiate conversation|cannot initiate conversation|bot was blocked by the user/i.test(e.message);
}

export function minutesLabel(ms: number) {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

// One delivery at a time per member, so double clicks or bot + website requests can't send twice.
const inFlight = new Set<number>();

/**
 * Sends videos to the member's Telegram.
 * - `videoIds` omitted = "Get all" (every available video, wrapped in the intro/outro messages).
 * - `force` (admin "Send videos now") ignores the re-delivery and cooldown rules.
 * Throws DeliveryError("need_start") when the user must press Start in the bot first.
 */
export async function deliverVideos(m: Member, s: Settings, opts: { videoIds?: number[]; force?: boolean } = {}): Promise<DeliveryReport> {
  if (inFlight.has(m.id)) throw new Error("A delivery is already in progress. Please wait a moment.");
  inFlight.add(m.id);
  try {
    return await runDelivery(m, s, opts);
  } finally {
    inFlight.delete(m.id);
  }
}

async function runDelivery(m: Member, s: Settings, opts: { videoIds?: number[]; force?: boolean }): Promise<DeliveryReport> {
  const token = s.telegram_bot_token;
  const chatId = m.telegram_id!;
  const all = await memberVideos(m, s);
  if (!all.length) throw new DeliveryError("No videos are available yet. Please check back later.", "no_videos");

  const wanted = opts.videoIds ? all.filter((v) => opts.videoIds!.includes(v.id)) : all;
  const toSend = opts.force ? wanted : wanted.filter((v) => v.status === "available");
  const report: DeliveryReport = { sent: 0, failed: 0, skipped: 0, results: [] };
  for (const v of wanted) {
    if (toSend.includes(v)) continue;
    report.skipped++;
    report.results.push({
      videoId: v.id,
      title: v.title,
      ok: false,
      skipped: true,
      error: v.status === "cooldown" ? `Available again in ${minutesLabel(v.availableAt!.getTime() - Date.now())}` : "Already sent",
    });
  }
  if (!toSend.length) {
    const one = wanted.length === 1 ? wanted[0] : null;
    const msg =
      one?.status === "cooldown"
        ? `You can request "${one.title}" again in ${minutesLabel(one.availableAt!.getTime() - Date.now())}.`
        : one
          ? `"${one.title}" has already been sent to your Telegram.`
          : "There are no videos available to send right now. Check your Telegram chat for the ones already sent.";
    throw new DeliveryError(msg, "nothing_available");
  }

  const byId = new Map((await activeVideos()).map((v) => [v.id, v]));
  const protect = bool(s.telegram_protect_content);
  const getAll = !opts.videoIds;
  const notStarted = (remaining: number[]) =>
    new DeliveryError("Open the bot in Telegram and press Start, then your videos will be sent automatically.", "need_start", remaining);

  if (getAll && s.telegram_intro_message?.trim()) {
    try {
      await tg(token, "sendMessage", { chat_id: chatId, text: s.telegram_intro_message, parse_mode: "HTML", protect_content: protect });
    } catch (e) {
      if (needsBotStart(e)) throw notStarted(toSend.map((v) => v.id));
    }
  }

  for (let i = 0; i < toSend.length; i++) {
    const v = byId.get(toSend[i].id)!;
    const params: Record<string, unknown> = { chat_id: chatId, from_chat_id: v.from_chat_id, message_id: Number(v.message_id), protect_content: protect };
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
      // The user hasn't started the bot: nothing more will get through, so hand the rest over to the bot.
      if (needsBotStart(e)) throw notStarted(toSend.slice(i).map((x) => x.id));
      const msg = (e as Error).message;
      report.failed++;
      report.results.push({ videoId: v.id, title: v.title, ok: false, error: msg });
      await execute("INSERT INTO deliveries (member_id, video_id, telegram_id, status, error) VALUES (?, ?, ?, 'failed', ?)", [
        m.id,
        v.id,
        chatId,
        msg.slice(0, 1000),
      ]);
    }
    await new Promise((r) => setTimeout(r, 60)); // stay well under Telegram's per-chat rate limit
  }

  if (getAll && report.sent > 0 && s.telegram_outro_message?.trim()) {
    await tg(token, "sendMessage", { chat_id: chatId, text: s.telegram_outro_message, parse_mode: "HTML", protect_content: protect }).catch(() => {});
  }
  if (report.sent > 0) {
    await execute("UPDATE members SET deliveries_count = deliveries_count + 1, last_delivered_at = UTC_TIMESTAMP() WHERE id = ?", [m.id]);
  }
  return report;
}

/** Remember which videos to send once the user presses Start in the bot. */
export async function setPendingVideos(memberId: number, ids: number[] | null) {
  await execute("UPDATE members SET pending_video_ids = ? WHERE id = ?", [ids?.length ? JSON.stringify(ids) : null, memberId]);
}

export function pendingVideoIds(m: Member): number[] {
  try {
    const list = JSON.parse(m.pending_video_ids ?? "[]");
    return Array.isArray(list) ? list.map(Number).filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

export function botStartUrl(s: Settings) {
  return s.telegram_bot_username ? `https://t.me/${s.telegram_bot_username}?start=video` : null;
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
