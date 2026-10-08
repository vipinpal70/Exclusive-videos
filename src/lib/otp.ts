import "server-only";
import crypto from "crypto";
import { execute, queryOne } from "./db";
import { sendOtpEmail } from "./email";
import type { Settings } from "./settings";

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;

const hashCode = (email: string, code: string) =>
  crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(`${email}:${code}`).digest("hex");

export async function issueOtp(s: Settings, email: string, ip: string): Promise<{ ok: true } | { ok: false; error: string; retryAfter?: number }> {
  const last = await queryOne<{ age: number }>(
    "SELECT TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP()) AS age FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1",
    [email]
  );
  if (last && Number(last.age) < RESEND_COOLDOWN_SECONDS) {
    const retryAfter = RESEND_COOLDOWN_SECONDS - Number(last.age);
    return { ok: false, error: `Please wait ${retryAfter}s before requesting a new code.`, retryAfter };
  }
  const hourCount = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM otp_codes WHERE email = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR",
    [email]
  );
  if (Number(hourCount?.c ?? 0) >= MAX_PER_HOUR) return { ok: false, error: "Too many codes requested. Try again in an hour." };

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiry = Number(s.otp_expiry_minutes) || 10;
  await sendOtpEmail(s, email, code);
  // Invalidate older codes so only the newest one works.
  await execute("UPDATE otp_codes SET consumed_at = UTC_TIMESTAMP() WHERE email = ? AND consumed_at IS NULL", [email]);
  await execute("INSERT INTO otp_codes (email, code_hash, expires_at, ip) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE, ?)", [
    email,
    hashCode(email, code),
    expiry,
    ip,
  ]);
  return { ok: true };
}

export async function checkOtp(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await queryOne<{ id: number; code_hash: string; attempts: number; expired: number }>(
    `SELECT id, code_hash, attempts, (expires_at < UTC_TIMESTAMP()) AS expired
     FROM otp_codes WHERE email = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`,
    [email]
  );
  if (!row) return { ok: false, error: "No active code. Request a new one." };
  if (Number(row.expired)) return { ok: false, error: "This code has expired. Request a new one." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong attempts. Request a new code." };

  const a = Buffer.from(hashCode(email, code.trim()));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?", [row.id]);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code." };
  }
  await execute("UPDATE otp_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
  return { ok: true };
}
