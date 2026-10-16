// Shared by server and client. Super admins implicitly hold every permission and can manage admins.

export const PERMISSIONS = [
  { key: "settings.elefin", label: "Edit Elefin API settings", desc: "API base URL and token, and run test lookups." },
  { key: "settings.xm", label: "Edit XM settings", desc: "XM API token, XM eligibility rules and test lookups." },
  { key: "settings.coinswitch", label: "Edit CoinSwitch settings", desc: "Set the CoinSwitch referral code and rules, and log in to the partner account used to fetch leads for bulk tools." },
  { key: "settings.eligibility", label: "Edit eligibility rules", desc: "Minimum lots, affiliation, deposit and re-delivery rules." },
  { key: "settings.email", label: "Edit OTP email settings", desc: "Turn email OTP on or off, Resend key, sender and email header." },
  { key: "settings.site", label: "Edit site settings", desc: "Site name, hero text, sign-up and support links." },
  { key: "settings.telegram", label: "Edit Telegram bot settings", desc: "Bot token, test chat, delivery messages and content protection." },
  { key: "videos.manage", label: "Add and edit videos", desc: "Add, edit, reorder, activate, verify and delete videos." },
  { key: "members.manage", label: "Edit members", desc: "Send videos, reset delivery, unlink Telegram, block and delete members." },
  { key: "members.export", label: "Export members", desc: "Download every member (emails, phone numbers, Telegram details) as Excel or CSV." },
  { key: "broadcast.send", label: "Bulk send videos", desc: "Send videos to every eligible member with Telegram linked, from the Members page." },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

/** Which permission is needed to edit each settings group. */
export const SETTINGS_GROUP_PERMISSION: Record<string, Permission> = {
  general: "settings.site",
  elefin: "settings.elefin",
  xm: "settings.xm",
  coinswitch: "settings.coinswitch",
  eligibility: "settings.eligibility",
  telegram: "settings.telegram",
  email: "settings.email",
};

export interface AdminUser {
  id: number;
  username: string;
  isSuper: boolean;
  permissions: Permission[];
}

export function can(admin: Pick<AdminUser, "isSuper" | "permissions"> | null | undefined, perm: Permission) {
  return !!admin && (admin.isSuper || admin.permissions.includes(perm));
}

export function parsePermissions(raw: unknown): Permission[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? ALL_PERMISSIONS.filter((p) => list.includes(p)) : [];
}
