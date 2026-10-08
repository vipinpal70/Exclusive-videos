import { adminRoute, fail, json } from "@/lib/auth";
import { ElefinError, listClients } from "@/lib/elefin";

export const maxDuration = 60;

/** One page of the broker's funded clients, trimmed to what the bulk-block rules need. ?page=N */
export const GET = adminRoute(async (req) => {
  const page = Math.max(1, Number(new URL(req.url).searchParams.get("page")) || 1);
  try {
    const r = await listClients(page, 200);
    return json({
      ok: true,
      page: r.page,
      lastPage: r.lastPage,
      total: r.total,
      clients: r.clients.map((c) => ({
        clientId: c.client_id,
        email: String(c.email ?? "").trim().toLowerCase(),
        name: c.name ?? null,
        lastTradeAt: c.trading?.last_trade_at ?? null,
        lastDepositAt: c.funding?.last_deposit_at ?? null,
      })),
    });
  } catch (e) {
    console.error("Elefin client list failed:", e);
    return fail(e instanceof ElefinError ? e.message : `Couldn't load clients from Elefin: ${(e as Error).message}`, 502);
  }
}, "members.manage");
