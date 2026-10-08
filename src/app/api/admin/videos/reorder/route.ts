import { adminRoute, fail, json } from "@/lib/auth";
import { execute } from "@/lib/db";

export const POST = adminRoute(async (req) => {
  const { ids } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids)) return fail("ids must be an array.");
  for (let i = 0; i < ids.length; i++) {
    await execute("UPDATE videos SET sort_order = ? WHERE id = ?", [i + 1, Number(ids[i])]);
  }
  return json({ ok: true });
}, "videos.manage");
