"use client";

import { Ban, CheckCircle2, Eye, Loader2, RefreshCw, RotateCcw, Send, Trash2, Unlink, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin-context";
import { useConfirm, type ConfirmOptions } from "@/components/confirm";
import { ActionMenu, Dot, Empty, Loading, Modal, PageHeader, Pagination, SearchInput, StatusBadge, Tabs, type MenuAction } from "@/components/admin-ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, timeAgo } from "@/lib/api";
import { BulkBlock } from "./bulk-block";
import { BulkSend } from "./bulk-send";

interface Member {
  id: number;
  email: string | null;
  broker: "elefin" | "xm" | "coinswitch";
  broker_account_id: string | null;
  phone: string | null;
  elefin_client_id: string | null;
  name: string | null;
  country: string | null;
  affiliated: number;
  lots: number;
  net_deposit: number;
  eligible: number;
  last_lookup_at: string | null;
  email_verified_at: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_name: string | null;
  telegram_photo_url: string | null;
  telegram_linked_at: string | null;
  deliveries_count: number;
  last_delivered_at: string | null;
  is_blocked: number;
  created_at: string;
  lookup_json?: string;
}

type Filter = "all" | "eligible" | "ineligible" | "linked" | "delivered" | "blocked" | "elefin" | "xm" | "coinswitch";

const BROKER_NAME = { elefin: "Elefin", xm: "XM", coinswitch: "CoinSwitch" } as const;

/** Email for Elefin members, "XM account <id>" for XM members (XM has no emails). */
const label = (m: Pick<Member, "broker" | "email" | "broker_account_id">) =>
  m.broker === "xm" ? `XM account ${m.broker_account_id}` : m.broker === "coinswitch" ? `CoinSwitch client ${m.broker_account_id}` : (m.email ?? "—");
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "eligible", label: "Eligible" },
  { id: "ineligible", label: "Not eligible" },
  { id: "linked", label: "Telegram linked" },
  { id: "delivered", label: "Received" },
  { id: "blocked", label: "Blocked" },
  { id: "elefin", label: "Elefin" },
  { id: "xm", label: "XM" },
  { id: "coinswitch", label: "CoinSwitch" },
];

type MemberAction = "deliver" | "refresh" | "reset_delivery" | "unlink_telegram" | "block" | "unblock";

/** Confirmation text for each member action. Every action asks before it runs. */
function confirmFor(action: MemberAction | "delete", m: Member): ConfirmOptions {
  const who = <span className="text-[#eceef2]">{m.name || label(m)}</span>;
  const tg = m.telegram_username ? `@${m.telegram_username}` : "their Telegram";
  switch (action) {
    case "deliver":
      return {
        title: "Send videos now?",
        message: <>All active videos will be sent to {who} on {tg} right away, including ones they already received. Re-delivery and cooldown rules don't apply to admin sends.</>,
        confirmLabel: "Send videos",
      };
    case "refresh":
      return {
        title: `Refresh from ${BROKER_NAME[m.broker]}?`,
        message: (
          <>
            Look up {who} in {BROKER_NAME[m.broker]} again and update their eligibility with the latest data.
          </>
        ),
        confirmLabel: "Refresh",
      };
    case "reset_delivery":
      return {
        title: "Reset delivery?",
        message: <>{who} will be able to request every video again straight away, even if re-delivery is turned off or a cooldown hasn't passed. Their delivery history is kept.</>,
        confirmLabel: "Reset delivery",
      };
    case "unlink_telegram":
      return {
        title: "Unlink Telegram?",
        message: <>{tg} will be disconnected from {who}. They will need to log in with Telegram again before receiving videos.</>,
        confirmLabel: "Unlink",
        danger: true,
      };
    case "block":
      return {
        title: "Block member?",
        message: <>{who} won't be able to verify or receive videos until you unblock them.</>,
        confirmLabel: "Block",
        danger: true,
      };
    case "unblock":
      return {
        title: "Unblock member?",
        message: <>{who} will be able to verify and request videos again.</>,
        confirmLabel: "Unblock",
      };
    case "delete":
      return {
        title: "Delete member?",
        message: <>{who} and their delivery history will be permanently deleted. If they verify again, they will appear as a new member.</>,
        confirmLabel: "Delete member",
        danger: true,
      };
  }
}

/** Shared member actions used by both the row menu and the details dialog. */
function useMemberActions(onChanged: () => void) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(m: Member, action: MemberAction) {
    if (!(await confirm(confirmFor(action, m)))) return false;
    setBusy(action);
    try {
      const r = await api<{ message: string }>(`/api/admin/members/${m.id}`, { body: { action } });
      toast(r.message, "success");
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function del(m: Member) {
    if (!(await confirm(confirmFor("delete", m)))) return false;
    setBusy("delete");
    try {
      await api(`/api/admin/members/${m.id}`, { method: "DELETE" });
      toast("Member deleted.", "success");
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const edit = useAdmin().can("members.manage");

  function menu(m: Member, extra: MenuAction[] = []): MenuAction[] {
    if (!edit) return extra;
    return [
      ...extra,
      { label: "Send videos now", icon: <Send />, onClick: () => act(m, "deliver"), disabled: !m.telegram_id },
      { label: `Refresh from ${BROKER_NAME[m.broker]}`, icon: <RefreshCw />, onClick: () => act(m, "refresh") },
      { label: "Reset delivery", icon: <RotateCcw />, onClick: () => act(m, "reset_delivery"), disabled: !m.last_delivered_at },
      { label: "Unlink Telegram", icon: <Unlink />, onClick: () => act(m, "unlink_telegram"), disabled: !m.telegram_id },
      m.is_blocked
        ? { label: "Unblock", icon: <CheckCircle2 />, onClick: () => act(m, "unblock"), separator: true }
        : { label: "Block", icon: <Ban />, onClick: () => act(m, "block"), separator: true },
      { label: "Delete", icon: <Trash2 />, onClick: () => del(m), danger: true },
    ];
  }

  return { act, del, menu, busy, edit };
}

export default function MembersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Members />
    </Suspense>
  );
}

function Members() {
  const sp = useSearchParams();
  const [filter, setFilter] = useState<Filter>((sp.get("filter") as Filter) || "all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ members: Member[]; total: number; pages: number } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams({ filter, q: query, page: String(page) });
    api<{ members: Member[]; total: number; pages: number }>(`/api/admin/members?${params}`)
      .then(setData)
      .catch((e) => toast(e.message, "error"));
  }, [filter, query, page, toast]);
  useEffect(load, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { menu } = useMemberActions(load);
  const { can } = useAdmin();
  const canBulk = can("broadcast.send");
  const canBlock = can("members.manage");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Everyone who has checked their Elefin email on the site."
        actions={
          <>
            {canBlock && (
              <>
                <button className="btn btn-secondary" onClick={() => setUnblockOpen(true)}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Bulk unblock
                </button>
                <button className="btn btn-secondary" onClick={() => setBlockOpen(true)}>
                  <Ban className="h-3.5 w-3.5" /> Bulk block
                </button>
              </>
            )}
            {canBulk && (
              <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>
                <Send className="h-3.5 w-3.5" /> Bulk send videos
              </button>
            )}
          </>
        }
      />
      <BulkBlock mode="block" open={blockOpen} onClose={() => setBlockOpen(false)} onFinished={load} />
      <BulkBlock mode="unblock" open={unblockOpen} onClose={() => setUnblockOpen(false)} onFinished={load} />
      <BulkSend open={bulkOpen} onClose={() => setBulkOpen(false)} onFinished={load} />

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-[#262a33] px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
          <Tabs<Filter>
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPage(1);
            }}
            tabs={FILTERS}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Email, name, @username or ID" />
        </div>

        {!data ? (
          <Loading />
        ) : data.members.length === 0 ? (
          <Empty icon={<Users />} title="No members found">
            Members appear here once someone checks their email on the site.
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table min-w-[820px]">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th className="w-[90px] text-right">Lots</th>
                    <th className="w-[140px]">Status</th>
                    <th className="w-[170px]">Telegram</th>
                    <th className="w-[150px]">Videos</th>
                    <th className="w-[100px] text-right">Last seen</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.id} className="cursor-pointer" onClick={() => setOpenId(m.id)}>
                      <td className="max-w-0">
                        <div className="flex items-center gap-1.5 truncate text-[#eceef2]">
                          {m.broker === "xm" && <span className="badge shrink-0 bg-[#2a1f3d] text-[#c4a8ff]">XM</span>}
                          {m.broker === "coinswitch" && <span className="badge shrink-0 bg-[#13302e] text-[#7fe0d2]">CoinSwitch</span>}
                          <span className="truncate">{m.name || (m.broker !== "elefin" ? m.broker_account_id : "—")}</span>
                        </div>
                        <div className="truncate text-[12px] text-[#7d8390]">{label(m)}</div>
                      </td>
                      <td className="text-right tabular-nums text-[#b4b9c4]">{Number(m.lots).toFixed(2)}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <Dot tone={m.is_blocked ? "error" : m.eligible ? "ok" : "muted"} />
                          <span className="text-[#b4b9c4]">{m.is_blocked ? "Blocked" : m.eligible ? "Eligible" : "Not eligible"}</span>
                        </span>
                        {m.email_verified_at && <div className="text-[12px] text-[#7d8390]">Email verified</div>}
                      </td>
                      <td className="truncate">
                        {m.telegram_id ? (
                          <span className="text-[#b4b9c4]">{m.telegram_username ? `@${m.telegram_username}` : m.telegram_id}</span>
                        ) : (
                          <span className="text-[#4d5360]">Not linked</span>
                        )}
                      </td>
                      <td>
                        {m.last_delivered_at ? (
                          <span className="text-[#b4b9c4]">
                            {m.deliveries_count}× <span className="text-[#7d8390]">· {timeAgo(m.last_delivered_at)}</span>
                          </span>
                        ) : (
                          <span className="text-[#4d5360]">None</span>
                        )}
                      </td>
                      <td className="text-right text-[#8b919d]">{timeAgo(m.last_lookup_at)}</td>
                      <td className="text-right">
                        <ActionMenu actions={menu(m, [{ label: "View details", icon: <Eye />, onClick: () => setOpenId(m.id) }])} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        )}
      </div>

      <MemberModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </>
  );
}

interface Delivery {
  id: number;
  title: string | null;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
}

function MemberModal({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ member: Member; deliveries: Delivery[] } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    if (!id) return;
    api<{ member: Member; deliveries: Delivery[] }>(`/api/admin/members/${id}`)
      .then(setData)
      .catch((e) => toast(e.message, "error"));
  }, [id, toast]);

  useEffect(() => {
    setData(null);
    setShowRaw(false);
    load();
  }, [load]);

  const { act, del, busy, edit } = useMemberActions(() => {
    load();
    onChanged();
  });

  const m = data?.member;

  const Btn = ({ action, icon, label }: { action: MemberAction; icon: React.ReactNode; label: string }) => (
    <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => act(m!, action)}>
      {busy === action ? <Loader2 className="h-3 w-3 animate-spin" /> : icon} {label}
    </button>
  );

  return (
    <Modal open={id !== null} onClose={onClose} title={m ? m.name || label(m) : "Member"} wide>
      {!m ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {edit && (
          <div className="flex flex-wrap gap-1.5">
            <Btn action="refresh" icon={<RefreshCw className="h-3 w-3" />} label="Refresh" />
            {m.telegram_id && <Btn action="deliver" icon={<Send className="h-3 w-3" />} label="Send videos" />}
            {m.last_delivered_at && <Btn action="reset_delivery" icon={<RotateCcw className="h-3 w-3" />} label="Reset delivery" />}
            {m.telegram_id && <Btn action="unlink_telegram" icon={<Unlink className="h-3 w-3" />} label="Unlink Telegram" />}
            {m.is_blocked ? (
              <Btn action="unblock" icon={<CheckCircle2 className="h-3 w-3" />} label="Unblock" />
            ) : (
              <Btn action="block" icon={<Ban className="h-3 w-3" />} label="Block" />
            )}
            <button className="btn btn-danger btn-sm ml-auto" disabled={!!busy} onClick={async () => (await del(m)) && onClose()}>
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {m.broker === "coinswitch" ? (
              <Section title="CoinSwitch">
                <Row k="Client ID" v={<span className="font-mono text-[12px]">{m.broker_account_id}</span>} />
                <Row k="Phone" v={m.phone ?? "—"} />
                <Row k="Eligible" v={<StatusBadge ok={!!m.eligible}>{m.eligible ? "Yes" : "No"}</StatusBadge>} />
                <Row k="Last checked" v={fmtDate(m.last_lookup_at)} />
              </Section>
            ) : m.broker === "xm" ? (
              <Section title="XM">
                <Row k="MT5 account" v={<span className="font-mono text-[12px]">{m.broker_account_id}</span>} />
                <Row k="Lots (recent window)" v={Number(m.lots).toFixed(2)} />
                <Row k="Eligible" v={<StatusBadge ok={!!m.eligible}>{m.eligible ? "Yes" : "No"}</StatusBadge>} />
                <Row k="Last checked" v={fmtDate(m.last_lookup_at)} />
              </Section>
            ) : (
              <Section title="Elefin">
                <Row k="Email" v={m.email ?? "—"} />
                <Row k="Client ID" v={m.elefin_client_id ?? "—"} />
                <Row k="Country" v={m.country ?? "—"} />
                <Row k="Lots traded" v={Number(m.lots).toFixed(2)} />
                <Row k="Net deposit" v={`${Number(m.net_deposit).toLocaleString()}`} />
                <Row k="Affiliated" v={m.affiliated ? "Yes" : "No"} />
                <Row k="Eligible" v={<StatusBadge ok={!!m.eligible}>{m.eligible ? "Yes" : "No"}</StatusBadge>} />
                <Row k="Email verified" v={fmtDate(m.email_verified_at)} />
                <Row k="Last checked" v={fmtDate(m.last_lookup_at)} />
              </Section>
            )}
            <Section title="Telegram">
              {m.telegram_id ? (
                <>
                  <Row k="Name" v={m.telegram_name ?? "—"} />
                  <Row
                    k="Username"
                    v={
                      m.telegram_username ? (
                        <a className="text-brand-300 hover:underline" href={`https://t.me/${m.telegram_username}`} target="_blank" rel="noreferrer">
                          @{m.telegram_username}
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Row k="User ID" v={<span className="font-mono text-[12px]">{m.telegram_id}</span>} />
                  <Row k="Linked" v={fmtDate(m.telegram_linked_at)} />
                  <Row k="Deliveries" v={m.deliveries_count} />
                  <Row k="Last delivery" v={fmtDate(m.last_delivered_at)} />
                </>
              ) : (
                <p className="px-3 py-2 text-[#7d8390]">Not linked yet.</p>
              )}
            </Section>
          </div>

          <div className="overflow-hidden rounded-[5px] border border-[#262a33]">
            <div className="border-b border-[#262a33] bg-[#13161b] px-3 py-2 text-[12px] font-medium text-[#b4b9c4]">Delivery history ({data.deliveries.length})</div>
            {data.deliveries.length === 0 ? (
              <p className="px-3 py-4 text-center text-[#7d8390]">No deliveries yet.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                <table className="table">
                  <tbody>
                    {data.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="text-[#d4d7de]">{d.title ?? "Deleted video"}</td>
                        <td>
                          <StatusBadge ok={d.status === "sent"}>{d.status === "sent" ? "Sent" : "Failed"}</StatusBadge>
                          {d.error && <div className="mt-0.5 text-[12px] text-[#f19aa5]">{d.error}</div>}
                        </td>
                        <td className="whitespace-nowrap text-right text-[12px] text-[#7d8390]">{fmtDate(d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {m.lookup_json && (
            <div>
              <button className="text-[12px] text-[#8b919d] underline hover:text-white" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? "Hide" : "Show"} raw {BROKER_NAME[m.broker]} response
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-[5px] border border-[#262a33] bg-[#0b0d10] p-3 font-mono text-[11px] text-[#b4b9c4]">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(m.lookup_json), null, 2);
                    } catch {
                      return m.lookup_json;
                    }
                  })()}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[5px] border border-[#262a33]">
      <div className="border-b border-[#262a33] bg-[#13161b] px-3 py-2 text-[12px] font-medium text-[#b4b9c4]">{title}</div>
      <div className="py-1">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1">
      <span className="text-[#7d8390]">{k}</span>
      <span className="truncate text-right text-[#d4d7de]">{v}</span>
    </div>
  );
}
