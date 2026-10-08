import "server-only";
import { execute, query } from "./db";
import { activeVideos, needsBotStart, type Member, type Video } from "./members";
import { bool, type Settings } from "./settings";
import { tg } from "./telegram";

/** One message to send: [memberId, videoId]. */
export type BroadcastItem = [number, number];

export type BroadcastMode = "all" | "new";

export interface BroadcastPlan {
  mode: BroadcastMode;
  items: BroadcastItem[];
  /** Members who will receive at least one video. */
  recipients: number;
  /** Eligible members with Telegram linked (whether or not they get anything). */
  linkedMembers: number;
  videos: number;
}

/** Most messages one batch request may carry (the admin page sends 20 per second). */
export const MAX_BATCH = 25;

/**
 * Works out who gets which videos.
 * - "all": every active video to every eligible, unblocked member with Telegram linked (ignores history and cooldowns).
 * - "new": only videos a member has never successfully received (since their last admin reset).
 * Items are ordered member by member, videos in list order, so each member receives them in sequence.
 */
export async function planBroadcast(mode: BroadcastMode): Promise<BroadcastPlan> {
  const members = await query<{ id: number }>(
    "SELECT id FROM members WHERE telegram_id IS NOT NULL AND eligible = 1 AND is_blocked = 0 ORDER BY id ASC"
  );
  const videos = await activeVideos();

  let received = new Set<string>();
  if (mode === "new") {
    const rows = await query<{ member_id: number; video_id: number }>(
      `SELECT d.member_id, d.video_id FROM deliveries d JOIN members m ON m.id = d.member_id
       WHERE d.status = 'sent' AND d.video_id IS NOT NULL AND (m.delivery_reset_at IS NULL OR d.created_at > m.delivery_reset_at)
       GROUP BY d.member_id, d.video_id`
    );
    received = new Set(rows.map((r) => `${r.member_id}:${r.video_id}`));
  }

  const items: BroadcastItem[] = [];
  const recipients = new Set<number>();
  for (const m of members) {
    for (const v of videos) {
      if (received.has(`${m.id}:${v.id}`)) continue;
      items.push([m.id, v.id]);
      recipients.add(m.id);
    }
  }
  return { mode, items, recipients: recipients.size, linkedMembers: members.length, videos: videos.length };
}

export type ItemStatus = "sent" | "failed" | "unreachable" | "skipped";
export interface ItemResult {
  memberId: number;
  videoId: number;
  status: ItemStatus;
  error?: string;
}

/**
 * Sends one batch. Members are processed in parallel; each member's videos are sent one after another
 * so they arrive in order. If the bot can't reach a member (not started / blocked), the rest of their
 * videos in this batch are marked unreachable without calling Telegram again.
 */
export async function sendBroadcastBatch(items: BroadcastItem[], s: Settings): Promise<ItemResult[]> {
  if (!items.length) return [];
  const memberIds = [...new Set(items.map(([m]) => m))];
  const members = await query<Member>(`SELECT * FROM members WHERE id IN (${memberIds.map(() => "?").join(",")})`, memberIds);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const videoById = new Map<number, Video>((await activeVideos()).map((v) => [v.id, v]));
  const protect = bool(s.telegram_protect_content);

  // Group by member, keeping the original order.
  const groups = new Map<number, number[]>();
  for (const [m, v] of items) groups.set(m, [...(groups.get(m) ?? []), v]);

  const results: ItemResult[] = [];
  await Promise.all(
    [...groups].map(async ([memberId, videoIds]) => {
      const m = memberById.get(memberId);
      let unreachable = false;
      let sentAny = false;
      for (const videoId of videoIds) {
        const v = videoById.get(videoId);
        if (!m || !m.telegram_id || m.is_blocked || !m.eligible || !v) {
          results.push({ memberId, videoId, status: "skipped", error: !v ? "Video is no longer active" : "Member is no longer eligible or linked" });
          continue;
        }
        if (unreachable) {
          results.push({ memberId, videoId, status: "unreachable", error: "The bot can't message this member" });
          continue;
        }
        const params: Record<string, unknown> = { chat_id: m.telegram_id, from_chat_id: v.from_chat_id, message_id: Number(v.message_id), protect_content: protect };
        if (v.caption?.trim()) {
          params.caption = v.caption;
          params.parse_mode = "HTML";
        }
        try {
          const res = await tg<{ message_id: number }>(s.telegram_bot_token, "copyMessage", params);
          sentAny = true;
          results.push({ memberId, videoId, status: "sent" });
          await execute("INSERT INTO deliveries (member_id, video_id, telegram_id, status, telegram_message_id) VALUES (?, ?, ?, 'sent', ?)", [
            m.id,
            v.id,
            m.telegram_id,
            res.message_id,
          ]);
        } catch (e) {
          const msg = (e as Error).message;
          if (needsBotStart(e)) unreachable = true;
          results.push({ memberId, videoId, status: unreachable ? "unreachable" : "failed", error: msg });
          await execute("INSERT INTO deliveries (member_id, video_id, telegram_id, status, error) VALUES (?, ?, ?, 'failed', ?)", [
            m.id,
            v.id,
            m.telegram_id,
            msg.slice(0, 1000),
          ]);
        }
      }
      if (sentAny) {
        await execute("UPDATE members SET deliveries_count = deliveries_count + 1, last_delivered_at = UTC_TIMESTAMP() WHERE id = ?", [memberId]);
      }
    })
  );
  return results;
}
