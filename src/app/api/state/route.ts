import { getUser, json, publicRoute } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { getMember, publicMember } from "@/lib/members";
import { getPublicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async () => {
  const [settings, user, vc] = await Promise.all([
    getPublicSettings(),
    getUser(),
    queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM videos WHERE is_active = 1"),
  ]);
  const member = user ? await getMember(user.mid) : null;
  return json({
    ok: true,
    settings: { ...settings, videoCount: Number(vc?.c ?? 0) },
    member: member && user && member.email === user.email ? publicMember(member, user.ev) : null,
  });
});
