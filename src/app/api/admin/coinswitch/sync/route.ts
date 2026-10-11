import { adminRoute, fail, json } from "@/lib/auth";
import { CsError, fetchLeadsPage, markSynced, saveLeads } from "@/lib/coinswitch";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export const maxDuration = 120;

/**
 * Fetches one page (500 leads) into the server-side cache, so the admin panel can show progress.
 * body: { page: number } (from 0). Returns only paging counts, never the leads themselves.
 */
export const POST = adminRoute(async (req, _ctx, admin) => {
  if (!can(admin, "settings.coinswitch") && !can(admin, "members.manage")) return fail("You don’t have permission to do this.", 403);
  const body = await req.json().catch(() => ({}));
  const page = Math.max(0, Math.floor(Number(body.page) || 0));
  const s = await getSettings();
  try {
    const r = await fetchLeadsPage(page, s);
    await saveLeads(r.clients);
    const last = page + 1 >= r.totalPages;
    if (last) await markSynced();
    return json({ ok: true, page, totalPages: r.totalPages, totalLeads: r.totalLeads, count: r.clients.length, done: last });
  } catch (e) {
    return fail(e instanceof CsError ? e.message : `Couldn’t load leads from CoinSwitch: ${(e as Error).message}`, 502, {
      code: e instanceof CsError ? e.code : undefined,
    });
  }
});
