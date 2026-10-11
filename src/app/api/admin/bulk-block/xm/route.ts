import { adminRoute, fail, json } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isLoginId, XM_IDS_PER_REQUEST, XM_MAX_DAYS, xmActivity, xmBalances, XmError } from "@/lib/xm";

export const maxDuration = 120;

/**
 * Activity for one batch of XM accounts (up to 50), for bulk block/unblock.
 * body: { loginIds: string[], days?: number | null, balance?: boolean }
 * Returns the last trade time in the window per account, and/or balance-over-threshold flags.
 */
export const POST = adminRoute(async (req) => {
  const s = await getSettings();
  if (!s.xm_api_token) return fail("The XM API token is not configured.");

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.loginIds) ? [...new Set<string>(body.loginIds.map(String).filter(isLoginId))] : [];
  if (!ids.length) return fail("No XM accounts to check.");
  if (ids.length > XM_IDS_PER_REQUEST) return fail(`Check at most ${XM_IDS_PER_REQUEST} accounts per request.`);
  const days = body.days ? Math.min(Math.max(1, Number(body.days)), XM_MAX_DAYS) : null;

  try {
    const activity = days ? await xmActivity(ids, days, s) : null;
    const balance = body.balance ? await xmBalances(ids, s) : null;
    return json({
      ok: true,
      lastTradeAt: activity ? Object.fromEntries(Object.entries(activity).map(([id, a]) => [id, a.lastTradeAt])) : null,
      balance,
    });
  } catch (e) {
    console.error("XM bulk check failed:", e);
    return fail(e instanceof XmError ? e.message : `Couldn’t load data from XM: ${(e as Error).message}`, 502);
  }
}, "members.manage");
