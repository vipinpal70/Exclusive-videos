import { getUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { getMember, memberKey, publicMember } from "@/lib/members";
import { getPublicSettings } from "@/lib/settings";
import { Flow } from "./flow";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [settings, user, vc] = await Promise.all([
    getPublicSettings(),
    getUser(),
    queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM videos WHERE is_active = 1"),
  ]);
  const m = user ? await getMember(user.mid) : null;
  const member = m && user && memberKey(m) === user.email && !m.is_blocked ? publicMember(m, user.ev) : null;

  return (
    <Flow
      settings={{ ...settings, videoCount: Number(vc?.c ?? 0) }}
      initialMember={member ? JSON.parse(JSON.stringify(member)) : null}
    />
  );
}
