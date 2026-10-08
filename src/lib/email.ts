import "server-only";
import type { Settings } from "./settings";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function otpEmailHtml(code: string, siteName: string, expiryMinutes: number, header?: string) {
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="padding:0 4px"><div style="width:44px;height:56px;line-height:56px;border-radius:10px;background:#0f172a;color:#ffffff;font-size:28px;font-weight:700;text-align:center;font-family:'SF Mono',Menlo,Consolas,monospace">${d}</div></td>`
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your verification code</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
        <tr><td style="background:#0a47ec;padding:28px 32px">
          <div style="color:#ffffff;font-size:20px;font-weight:700">${esc(header?.trim() || siteName)}</div>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 8px;font-size:22px;color:#0f172a">Your verification code</h1>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">Use this code to verify and continue to <strong style="color:#0f172a">${esc(siteName)}</strong>.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px"><tr>${digits}</tr></table>
          <p style="margin:0 0 8px;color:#475569;font-size:14px;line-height:1.6">This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6">If you didn't request this, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">&copy; ${new Date().getFullYear()} ${esc(siteName)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendEmail(s: Settings, to: string, subject: string, html: string, text: string) {
  if (!s.resend_api_key) throw new Error("Resend API key is not configured");
  if (!s.resend_from_email) throw new Error("From email is not configured");
  // In `next dev`, never email real users: send everything to DEV_EMAIL instead.
  const devEmail = process.env.NODE_ENV === "development" ? process.env.DEV_EMAIL?.trim() : "";
  if (devEmail) {
    subject = `[DEV → ${to}] ${subject}`;
    to = devEmail;
  }
  const from = s.resend_from_name ? `${s.resend_from_name.replace(/[<>"]/g, "")} <${s.resend_from_email}>` : s.resend_from_email;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.resend_api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok) throw new Error(`Resend error (HTTP ${res.status}): ${body?.message ?? "unknown"}`);
  return body?.id;
}

export function sendOtpEmail(s: Settings, to: string, code: string) {
  const expiry = Number(s.otp_expiry_minutes) || 10;
  return sendEmail(
    s,
    to,
    `${code} is your verification code`,
    otpEmailHtml(code, s.site_name, expiry, s.email_header),
    `Use this code to verify and continue to ${s.site_name}: ${code}

It expires in ${expiry} minutes. If you didn't request this, you can ignore this email.`
  );
}
