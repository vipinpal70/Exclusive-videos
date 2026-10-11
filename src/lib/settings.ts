import "server-only";
import { execute, query } from "./db";

export type SettingType = "text" | "secret" | "number" | "boolean" | "textarea" | "url" | "email";

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  group: "general" | "elefin" | "xm" | "coinswitch" | "eligibility" | "telegram" | "email";
  default: string;
  help?: string;
  placeholder?: string;
  /** Internal value managed by the app; not shown or editable in the settings form. */
  internal?: boolean;
}

export const SETTING_DEFS: SettingDef[] = [
  // General / branding
  {
    key: "site_name",
    label: "Site name",
    type: "text",
    group: "general",
    default: "The Traders' Circle",
    help: "Shown in the page header, browser tab, admin sidebar and email copyright line.",
  },
  { key: "hero_title", label: "Hero title", type: "text", group: "general", default: "Mentorship access", help: "Main heading on the first step of the public page." },
  {
    key: "hero_subtitle",
    label: "Hero subtitle",
    type: "textarea",
    group: "general",
    default: "Use the Elefin trading account you already have. Your eligibility, Telegram delivery and the full mentorship series are waiting.",
    help: "Short text shown under the hero title.",
  },
  { key: "signup_url", label: "Elefin sign-up / referral link", type: "url", group: "general", default: "", help: "Shown to visitors who are not yet eligible.", placeholder: "https://..." },
  { key: "support_url", label: "Support link", type: "url", group: "general", default: "", help: "Telegram or website where users can get help.", placeholder: "https://t.me/yoursupport" },

  // Elefin API
  { key: "elefin_api_base", label: "API base URL", type: "url", group: "elefin", default: "", help: "Without trailing slash. /clients/lookup is appended.", placeholder: "https://api.elefin.com/v1" },
  { key: "elefin_api_token", label: "API token", type: "secret", group: "elefin", default: "", help: "Sent as Authorization: Bearer <token> on every Elefin request." },

  // XM broker
  { key: "xm_enabled", label: "Allow XM clients", type: "boolean", group: "xm", default: "0", help: "Show an XM option on the website so XM clients can verify with their MT5 account ID." },
  { key: "xm_api_base", label: "API base URL", type: "url", group: "xm", default: "https://mypartners.xm.com/api", help: "XM partners API, without trailing slash." },
  { key: "xm_api_token", label: "API token", type: "secret", group: "xm", default: "", help: "From XM partners. Sent as Authorization: Bearer <token>." },
  { key: "xm_signup_url", label: "XM sign-up / referral link", type: "url", group: "xm", default: "", help: "Shown to XM clients who aren't under your affiliation or aren't eligible yet.", placeholder: "https://..." },
  { key: "xm_min_lots", label: "Minimum lots traded", type: "number", group: "xm", default: "1", help: "Lots the XM account must have traded within the window below." },
  {
    key: "xm_lots_window_days",
    label: "Lots window (days)",
    type: "number",
    group: "xm",
    default: "90",
    help: "Count lots traded in the last N days (max 365). XM only returns 93 days per request, so longer windows take a few requests.",
  },
  { key: "xm_reject_archived", label: "Reject archived accounts", type: "boolean", group: "xm", default: "1", help: "Reject accounts XM has archived." },
  {
    key: "xm_require_balance",
    label: "Require balance above threshold",
    type: "boolean",
    group: "xm",
    default: "0",
    help: "Uses XM's balance threshold indicator. The threshold itself is set with XM, not here.",
  },

  // Eligibility
  { key: "min_lots", label: "Minimum lots traded", type: "number", group: "eligibility", default: "1", help: "Users need at least this many total lots to get the videos." },
  { key: "require_affiliated", label: "Require client to be affiliated", type: "boolean", group: "eligibility", default: "1", help: "Reject clients that are not under your referral (affiliated = false)." },
  { key: "require_active", label: "Require active status", type: "boolean", group: "eligibility", default: "0", help: "Reject clients whose status is not \"active\"." },
  { key: "min_net_deposit", label: "Minimum net deposit (USD)", type: "number", group: "eligibility", default: "0", help: "0 disables this check." },
  { key: "allow_redelivery", label: "Allow users to request videos again", type: "boolean", group: "eligibility", default: "1", help: "Applies to each video. If off, each user can receive every video only once (admins can reset). New videos can always be requested." },
  {
    key: "redelivery_cooldown_minutes",
    label: "Re-delivery cooldown (minutes)",
    type: "number",
    group: "eligibility",
    default: "60",
    help: "Per video: how long a user must wait after receiving a video before requesting that video again. Only applies when re-delivery is allowed. 0 means no wait.",
  },

  // Telegram
  { key: "telegram_bot_token", label: "Bot token", type: "secret", group: "telegram", default: "", help: "From @BotFather. The bot must be an admin in your private video channel." },
  { key: "telegram_bot_username", label: "Bot username", type: "text", group: "telegram", default: "", help: "Filled automatically when you test / save the token." },
  {
    key: "telegram_client_id",
    label: "Login client ID",
    type: "text",
    group: "telegram",
    default: "",
    help: "From @BotFather → your bot → Login Widget. Used for Telegram Login (it is your bot's numeric ID).",
    placeholder: "123456789",
  },
  {
    key: "telegram_client_secret",
    label: "Login client secret",
    type: "secret",
    group: "telegram",
    default: "",
    help: "From the same Login Widget section in @BotFather. Keep it private.",
  },
  { key: "telegram_test_chat_id", label: "Test chat ID", type: "text", group: "telegram", default: "", help: "Optional. Your own Telegram user ID — video verification will send a test copy here to prove the message exists." },
  { key: "telegram_intro_message", label: "Message before videos", type: "textarea", group: "telegram", default: "🎓 Welcome to the Elefin exclusive mentorship! Your videos are below.", help: "HTML allowed. Leave empty to send no intro." },
  { key: "telegram_outro_message", label: "Message after videos", type: "textarea", group: "telegram", default: "", help: "HTML allowed. Leave empty to skip." },
  { key: "telegram_protect_content", label: "Protect delivered content", type: "boolean", group: "telegram", default: "1", help: "Users cannot forward or save the delivered videos." },

  // Email / OTP
  { key: "otp_enabled", label: "Require email OTP", type: "boolean", group: "email", default: "0", help: "Users must confirm they own the email with a one-time code." },
  { key: "resend_api_key", label: "Resend API key", type: "secret", group: "email", default: "", help: "Create one at resend.com → API Keys with sending access." },
  { key: "resend_from_email", label: "From email", type: "email", group: "email", default: "", placeholder: "no-reply@yourdomain.com", help: "Must be on a domain verified in Resend." },
  { key: "resend_from_name", label: "From name", type: "text", group: "email", default: "Elefin Mentorship", help: "Sender name shown in the recipient's inbox." },
  {
    key: "email_header",
    label: "Email header",
    type: "text",
    group: "email",
    default: "",
    help: "Text in the coloured banner at the top of the code email. Leave empty to use the site name.",
  },
  {
    key: "otp_expiry_minutes",
    label: "OTP expiry (minutes)",
    type: "number",
    group: "email",
    default: "10",
    help: "How long a verification code stays valid. Requesting a new code cancels the previous one.",
  },

  // CoinSwitch
  { key: "cs_enabled", label: "Allow CoinSwitch clients", type: "boolean", group: "coinswitch", default: "0", help: "Show a CoinSwitch option on the website. Clients verify with their CoinSwitch client ID and phone number." },
  { key: "cs_signup_url", label: "CoinSwitch sign-up / referral link", type: "url", group: "coinswitch", default: "", help: "Shown to CoinSwitch clients who aren't in your affiliate leads or aren't eligible yet.", placeholder: "https://..." },
  { key: "cs_require_kyc", label: "Require KYC completed", type: "boolean", group: "coinswitch", default: "0", help: "The lead's KYC status must be complete." },
  { key: "cs_require_bank", label: "Require bank account added", type: "boolean", group: "coinswitch", default: "0", help: "The lead's bank status must be complete." },
  { key: "cs_require_deposit", label: "Require a deposit", type: "boolean", group: "coinswitch", default: "0", help: "The lead's deposit status must be complete." },
  { key: "cs_require_trade", label: "Require a trade", type: "boolean", group: "coinswitch", default: "1", help: "The lead's trade status must be complete." },
  {
    key: "cs_cache_minutes",
    label: "Lead list refresh (minutes)",
    type: "number",
    group: "coinswitch",
    default: "15",
    help: "When a client isn't found in the saved lead list and it's older than this, the app fetches the latest leads from CoinSwitch before giving up.",
  },

  // Internal: CoinSwitch login state (managed from the CoinSwitch access token panel).
  { key: "cs_phone", label: "CoinSwitch login phone", type: "text", group: "coinswitch", default: "", internal: true },
  { key: "cs_refresh_token", label: "CoinSwitch refresh token", type: "secret", group: "coinswitch", default: "", internal: true },
  { key: "cs_access_token", label: "CoinSwitch access token", type: "secret", group: "coinswitch", default: "", internal: true },
  { key: "cs_token_expires_at", label: "CoinSwitch token expiry", type: "text", group: "coinswitch", default: "", internal: true },
  { key: "cs_last_sync_at", label: "CoinSwitch last lead sync", type: "text", group: "coinswitch", default: "", internal: true },

  // Internal: set by the app when the bot webhook is connected.
  { key: "telegram_webhook_secret", label: "Webhook secret", type: "secret", group: "telegram", default: "", internal: true },
  { key: "public_site_url", label: "Public site URL", type: "url", group: "general", default: "", internal: true },
];

const DEF_MAP = new Map(SETTING_DEFS.map((d) => [d.key, d]));

export type Settings = Record<string, string>;

export async function getSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: string | null }>("SELECT `key`, `value` FROM settings");
  const out: Settings = {};
  for (const d of SETTING_DEFS) out[d.key] = d.default;
  for (const r of rows) if (r.value !== null) out[r.key] = r.value;
  return out;
}

export async function getSetting(key: string): Promise<string> {
  const s = await getSettings();
  return s[key] ?? "";
}

export async function setSettings(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!DEF_MAP.has(key)) continue;
    await execute("INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)", [key, value]);
  }
}

export const bool = (v: string | undefined) => v === "1" || v === "true";
export const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function maskSecret(v: string) {
  if (!v) return "";
  if (v.length <= 8) return "••••••••";
  return `${"•".repeat(8)}${v.slice(-4)}`;
}

/** Settings safe to send to the admin UI (secrets masked). */
export async function getSettingsForAdmin() {
  const s = await getSettings();
  return SETTING_DEFS.filter((d) => !d.internal).map((d) => ({
    ...d,
    value: d.type === "secret" ? "" : s[d.key],
    isSet: !!s[d.key],
    masked: d.type === "secret" ? maskSecret(s[d.key]) : undefined,
  }));
}

/** Public settings for the landing page. */
export async function getPublicSettings() {
  const s = await getSettings();
  return {
    siteName: s.site_name,
    heroTitle: s.hero_title,
    heroSubtitle: s.hero_subtitle,
    signupUrl: s.signup_url,
    supportUrl: s.support_url,
    otpEnabled: bool(s.otp_enabled),
    botUsername: s.telegram_bot_username,
    telegramLoginReady: !!(s.telegram_client_id && s.telegram_client_secret),
    minLots: num(s.min_lots),
    xmEnabled: bool(s.xm_enabled) && !!s.xm_api_token,
    xmMinLots: num(s.xm_min_lots),
    xmSignupUrl: s.xm_signup_url,
    csEnabled: bool(s.cs_enabled),
    csSignupUrl: s.cs_signup_url,
    xmLotsWindowDays: num(s.xm_lots_window_days, 90),
  };
}
