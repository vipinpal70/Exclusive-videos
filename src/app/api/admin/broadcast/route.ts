import { adminRoute, json } from "@/lib/auth";
import { planBroadcast } from "@/lib/broadcast";

/** Preview a bulk send: who gets which videos. ?mode=all (every video, ignore history) or ?mode=new (unreceived only). */
export const GET = adminRoute(async (req) => {
  const mode = new URL(req.url).searchParams.get("mode") === "all" ? "all" : "new";
  return json({ ok: true, ...(await planBroadcast(mode)) });
}, "broadcast.send");
