"use client";

import { Ban, CheckCircle2, Info, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/admin-ui";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { api, fmtDate } from "@/lib/api";

interface BrokerClient {
  clientId: number;
  email: string;
  name: string | null;
  lastTradeAt: string | null;
  lastDepositAt: string | null;
}
interface MemberRow {
  id: number;
  email: string;
  name: string | null;
  blocked: boolean;
}
interface ClientsPage {
  page: number;
  lastPage: number;
  total: number;
  clients: BrokerClient[];
}

export type BulkMode = "block" | "unblock";
type Phase = "rules" | "collecting" | "review" | "applying" | "done";
type Match = "all" | "any";

const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
const parseDays = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
/** True when the date falls inside the last `days` days. No date on record never counts as recent. */
const within = (iso: string | null, days: number) => !!iso && Date.parse(iso) >= Date.now() - days * 86_400_000;
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/**
 * Bulk block (inactive members) or bulk unblock (blocked members who are active again),
 * based on trade/deposit activity from the broker's funded client list.
 */
export function BulkBlock({ mode, open, onClose, onFinished }: { mode: BulkMode; open: boolean; onClose: () => void; onFinished: () => void }) {
  const isBlock = mode === "block";
  const [tradeDays, setTradeDays] = useState("");
  const [depositDays, setDepositDays] = useState("");
  const [match, setMatch] = useState<Match>(isBlock ? "all" : "any");
  const [phase, setPhase] = useState<Phase>("rules");
  const [progress, setProgress] = useState({ page: 0, lastPage: 0, collected: 0, total: 0 });
  const [error, setError] = useState("");
  const [clients, setClients] = useState<BrokerClient[]>([]);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [changedCount, setChangedCount] = useState(0);
  const cancelRef = useRef(false);
  const resumeFrom = useRef(1);
  const confirm = useConfirm();
  const toast = useToast();

  const trade = parseDays(tradeDays);
  const deposit = parseDays(depositDays);
  const hasRule = trade !== null || deposit !== null;
  const bothRules = trade !== null && deposit !== null;
  const blockedMembers = members?.filter((m) => m.blocked).length ?? 0;
  const nothingBlocked = !isBlock && members !== null && blockedMembers === 0;

  // Load members when the dialog opens. For unblock, this tells us straight away whether anyone is blocked.
  useEffect(() => {
    if (!open || members !== null) return;
    api<{ members: MemberRow[] }>("/api/admin/bulk-block")
      .then((r) => setMembers(r.members))
      .catch((e) => setError((e as Error).message));
  }, [open, members]);

  function reset() {
    setPhase("rules");
    setError("");
    setClients([]);
    setMembers(null);
    setProgress({ page: 0, lastPage: 0, collected: 0, total: 0 });
    resumeFrom.current = 1;
  }

  function close() {
    if (phase === "applying") return;
    if (phase === "collecting") cancelRef.current = true;
    reset();
    onClose();
  }

  /** Pulls every page of the broker's funded clients (200 per page), resuming after an error. */
  async function collect() {
    if (!hasRule) return;
    cancelRef.current = false;
    setError("");
    setPhase("collecting");
    try {
      if (!members) setMembers((await api<{ members: MemberRow[] }>("/api/admin/bulk-block")).members);
      let page = resumeFrom.current;
      let lastPage = Math.max(page, progress.lastPage || page);
      while (page <= lastPage) {
        if (cancelRef.current) return;
        const r = await api<ClientsPage>(`/api/admin/bulk-block/clients?page=${page}`);
        lastPage = r.lastPage;
        setClients((list) => [...list, ...r.clients]);
        setProgress((p) => ({ page, lastPage, collected: p.collected + r.clients.length, total: r.total }));
        page++;
        resumeFrom.current = page;
      }
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Classify members by the current rules. Runs live, so editing the rules on the review step recounts instantly.
  const result = useMemo(() => {
    // One record per email, using the most recent trade/deposit across duplicate client records.
    const byEmail = new Map<string, BrokerClient>();
    for (const c of clients) {
      if (!c.email) continue;
      const prev = byEmail.get(c.email);
      byEmail.set(
        c.email,
        prev ? { ...prev, lastTradeAt: later(prev.lastTradeAt, c.lastTradeAt), lastDepositAt: later(prev.lastDepositAt, c.lastDepositAt) } : c
      );
    }

    /** Block: the member has been inactive. Unblock: the member has been active. */
    const matches = (c: BrokerClient) => {
      const checks: boolean[] = [];
      if (trade !== null) checks.push(isBlock ? !within(c.lastTradeAt, trade) : within(c.lastTradeAt, trade));
      if (deposit !== null) checks.push(isBlock ? !within(c.lastDepositAt, deposit) : within(c.lastDepositAt, deposit));
      return checks.length > 0 && (match === "all" ? checks.every(Boolean) : checks.some(Boolean));
    };

    const list = members ?? [];
    const toChange: { member: MemberRow; client: BrokerClient }[] = [];
    let unchanged = 0; // block: active members (safe) · unblock: blocked members who stay blocked
    let alreadyBlocked = 0;
    let notRegistered = 0;
    let notInBrokerList = 0;

    if (isBlock) {
      const memberByEmail = new Map(list.map((m) => [m.email, m]));
      for (const c of byEmail.values()) {
        const m = memberByEmail.get(c.email);
        if (!m) notRegistered++;
        else if (!matches(c)) unchanged++;
        else if (m.blocked) alreadyBlocked++;
        else toChange.push({ member: m, client: c });
      }
      notInBrokerList = list.filter((m) => !byEmail.has(m.email)).length;
    } else {
      for (const m of list.filter((x) => x.blocked)) {
        const c = byEmail.get(m.email);
        if (!c) notInBrokerList++;
        else if (matches(c)) toChange.push({ member: m, client: c });
        else unchanged++;
      }
    }
    return { toChange, unchanged, alreadyBlocked, notRegistered, notInBrokerList, uniqueClients: byEmail.size };
  }, [clients, members, trade, deposit, match, isBlock]);

  async function apply() {
    const n = result.toChange.length;
    const ok = await confirm({
      title: `${isBlock ? "Block" : "Unblock"} ${plural(n, "member")}?`,
      message: isBlock ? (
        <>
          {ruleSummary(mode, trade, deposit, match)}. Blocked members can&apos;t verify or receive videos until you unblock them.{" "}
          {plural(result.unchanged, "member")} will stay active.
        </>
      ) : (
        <>
          {ruleSummary(mode, trade, deposit, match)}. They&apos;ll be able to verify and request videos again. {plural(result.unchanged, "member")} will
          stay blocked.
        </>
      ),
      confirmLabel: `${isBlock ? "Block" : "Unblock"} ${fmt(n)}`,
      danger: isBlock,
    });
    if (!ok) return;
    setPhase("applying");
    try {
      const r = await api<{ changed: number; message: string }>("/api/admin/bulk-block", {
        body: { memberIds: result.toChange.map((x) => x.member.id), action: mode },
      });
      setChangedCount(r.changed);
      setPhase("done");
      toast(r.message, "success");
      onFinished();
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  }

  const pct = progress.lastPage ? Math.round((progress.page / progress.lastPage) * 100) : 0;
  const verb = isBlock ? "Block" : "Unblock";

  const rulesEditor = (
    <div className="space-y-2">
      {(
        [
          [isBlock ? "Hasn’t traded in the last" : "Traded in the last", tradeDays, setTradeDays],
          [isBlock ? "Hasn’t deposited in the last" : "Deposited in the last", depositDays, setDepositDays],
        ] as const
      ).map(([label, value, set]) => (
        <div key={label} className="flex items-center gap-3 rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2">
          <span className="flex-1 text-[13px] text-[#d4d7de]">{label}</span>
          <input
            className="input w-[90px] text-right"
            type="number"
            min={1}
            placeholder="Off"
            value={value}
            onChange={(e) => set(e.target.value)}
            disabled={phase === "collecting" || phase === "applying"}
          />
          <span className="w-8 text-[13px] text-[#8b919d]">days</span>
        </div>
      ))}
      {bothRules && (
        <div className="flex items-center justify-between gap-3 rounded-[5px] border border-[#262a33] px-3 py-2">
          <span className="text-[13px] text-[#d4d7de]">{verb} a member when</span>
          <div className="flex rounded-[5px] border border-[#323743] p-0.5">
            {(
              [
                ["all", "Both rules match"],
                ["any", "Either rule matches"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMatch(k)}
                className={`h-6 rounded-[3px] px-2.5 text-[12px] font-medium ${match === k ? "bg-[#232833] text-white" : "text-[#8b919d] hover:text-[#d4d7de]"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="hint">
        Leave a rule empty to skip it. At least one rule is required.{" "}
        {isBlock ? "Members with no trade or deposit on record count as inactive." : "Members with no trade or deposit on record don’t meet that rule."}
      </p>
    </div>
  );

  const notice = (icon: React.ReactNode, text: React.ReactNode) => (
    <div className="flex items-start gap-2 rounded-[5px] border border-[#2b3a5c] bg-[#121a2c] px-3 py-2.5 text-[13px] text-[#a9c1ff]">
      {icon}
      <div>{text}</div>
    </div>
  );

  const stats = isBlock
    ? [
        { label: "Will be blocked", value: result.toChange.length, cls: "text-[#f19aa5]" },
        { label: "Safe (active)", value: result.unchanged, cls: "text-[#6fd99a]" },
        { label: "Not registered here", value: result.notRegistered, cls: "text-[#b4b9c4]" },
        { label: "Already blocked", value: result.alreadyBlocked, cls: "text-[#b4b9c4]" },
      ]
    : [
        { label: "Will be unblocked", value: result.toChange.length, cls: "text-[#6fd99a]" },
        { label: "Stay blocked", value: result.unchanged, cls: "text-[#f19aa5]" },
        { label: "Not in Elefin list", value: result.notInBrokerList, cls: "text-[#b4b9c4]" },
        { label: "Blocked in total", value: blockedMembers, cls: "text-[#b4b9c4]" },
      ];

  return (
    <Modal
      open={open}
      onClose={close}
      title={isBlock ? "Bulk block members" : "Bulk unblock members"}
      wide
      footer={
        phase === "rules" ? (
          <>
            <button className="btn btn-secondary" onClick={close}>
              {nothingBlocked ? "Close" : "Cancel"}
            </button>
            {!nothingBlocked && (
              <button className="btn btn-primary" onClick={collect} disabled={!hasRule || members === null}>
                Collect data from Elefin
              </button>
            )}
          </>
        ) : phase === "collecting" ? (
          <>
            <button className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
            {error && (
              <button className="btn btn-primary" onClick={collect}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry from page {resumeFrom.current}
              </button>
            )}
          </>
        ) : phase === "review" || phase === "applying" ? (
          <>
            <button className="btn btn-secondary" onClick={close} disabled={phase === "applying"}>
              Cancel
            </button>
            <button
              className={`btn ${isBlock ? "btn-danger" : "btn-primary"}`}
              onClick={apply}
              disabled={!hasRule || result.toChange.length === 0 || phase === "applying"}
            >
              {phase === "applying" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isBlock ? (
                <Ban className="h-3.5 w-3.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}{" "}
              {verb} {plural(result.toChange.length, "member")}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={close}>
            Close
          </button>
        )
      }
    >
      {phase === "rules" &&
        (members === null && !error ? (
          <div className="flex items-center gap-2 py-6 text-[#8b919d]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
          </div>
        ) : nothingBlocked ? (
          notice(<Info className="mt-0.5 h-4 w-4 shrink-0" />, "No members have been blocked, so there’s nobody to unblock.")
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-[#8b919d]">
              {isBlock
                ? "Block members who have gone inactive at Elefin. We’ll load every funded client from Elefin, match them to members by email, and show the result before anything is blocked."
                : "Unblock members who are active at Elefin again."}
              {!isBlock && (
                <>
                  {" "}
                  {blockedMembers === 1 ? "1 member is" : `${fmt(blockedMembers)} members are`} blocked right now. We&apos;ll load every funded client from
                  Elefin and show who qualifies before anything changes.
                </>
              )}
            </p>
            {rulesEditor}
            {error && <p className="rounded-[5px] border border-[#4a2429] bg-[#2a1518] px-3 py-2 text-[12px] text-[#f5b8c0]">{error}</p>}
          </div>
        ))}

      {phase === "collecting" && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="flex items-center gap-2 text-[#d4d7de]">
              {!error && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Collecting clients from Elefin…
            </span>
            <span className="tabular-nums text-[#8b919d]">
              {progress.lastPage
                ? `Page ${fmt(progress.page)} of ${fmt(progress.lastPage)} · ${fmt(progress.collected)} of ${fmt(progress.total)} clients`
                : "Starting…"}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#232833]">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          {error && <p className="rounded-[5px] border border-[#4a2429] bg-[#2a1518] px-3 py-2 text-[12px] text-[#f5b8c0]">{error}</p>}
        </div>
      )}

      {(phase === "review" || phase === "applying") && (
        <div className="space-y-4">
          {rulesEditor}
          {!hasRule ? (
            <p className="text-[13px] text-[#f19aa5]">Set at least one rule to see who would be {isBlock ? "blocked" : "unblocked"}.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2">
                    <div className="text-[12px] text-[#7d8390]">{s.label}</div>
                    <div className={`text-[20px] font-semibold tabular-nums ${s.cls}`}>{fmt(s.value)}</div>
                  </div>
                ))}
              </div>

              {result.toChange.length === 0 &&
                notice(
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />,
                  isBlock
                    ? "No active members match these rules, so nobody will be blocked. Try different rules."
                    : "No blocked members meet these rules, so nobody will be unblocked. Try fewer days or a different rule."
                )}

              <p className="text-[12px] text-[#7d8390]">
                {isBlock ? (
                  <>
                    Checked {fmt(result.uniqueClients)} funded Elefin clients against {fmt(members?.length ?? 0)} members. &ldquo;Not registered
                    here&rdquo; are Elefin clients who never verified on this site.
                    {result.notInBrokerList > 0 &&
                      ` ${plural(result.notInBrokerList, "member")} ${result.notInBrokerList === 1 ? "isn’t" : "aren’t"} in Elefin’s funded list and won’t be changed.`}
                  </>
                ) : (
                  <>
                    Checked {plural(blockedMembers, "blocked member")} against {fmt(result.uniqueClients)} funded Elefin clients.
                    {result.notInBrokerList > 0 && " Members missing from Elefin’s funded list stay blocked."}
                  </>
                )}
              </p>

              {result.toChange.length > 0 && (
                <div className="overflow-hidden rounded-[5px] border border-[#262a33]">
                  <div className="border-b border-[#262a33] bg-[#13161b] px-3 py-2 text-[12px] font-medium text-[#b4b9c4]">
                    Members to {isBlock ? "block" : "unblock"}
                    {result.toChange.length > 300 && <span className="font-normal text-[#7d8390]"> (first 300 shown)</span>}
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th className="w-[170px]">Last trade</th>
                          <th className="w-[170px]">Last deposit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.toChange.slice(0, 300).map(({ member, client }) => (
                          <tr key={member.id}>
                            <td>
                              <div className="truncate text-[#eceef2]">{member.name || client.name || "—"}</div>
                              <div className="truncate text-[12px] text-[#7d8390]">{member.email}</div>
                            </td>
                            <td className="text-[#8b919d]">{client.lastTradeAt ? fmtDate(client.lastTradeAt) : "Never"}</td>
                            <td className="text-[#8b919d]">{client.lastDepositAt ? fmtDate(client.lastDepositAt) : "Never"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
          {error && <p className="rounded-[5px] border border-[#4a2429] bg-[#2a1518] px-3 py-2 text-[12px] text-[#f5b8c0]">{error}</p>}
        </div>
      )}

      {phase === "done" && (
        <div className="flex items-start gap-2 rounded-[5px] border border-[#1d4430] bg-[#0f2418] px-3 py-2.5 text-[13px] text-[#8fe3b0]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {isBlock
            ? `${plural(changedCount, "member")} blocked. You can unblock anyone from their ⋯ menu, or with Bulk unblock.`
            : `${plural(changedCount, "member")} unblocked. They can verify and request videos again.`}
        </div>
      )}
    </Modal>
  );
}

function ruleSummary(mode: BulkMode, trade: number | null, deposit: number | null, match: Match) {
  const neg = mode === "block" ? "no " : "a ";
  const parts = [
    trade !== null && `${neg}trade in the last ${trade} day${trade === 1 ? "" : "s"}`,
    deposit !== null && `${neg}deposit in the last ${deposit} day${deposit === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  const joined = parts.length === 2 ? parts.join(match === "all" ? " and " : " or ") : parts[0];
  return mode === "block" ? `Members with ${joined} will be blocked` : `Blocked members with ${joined} will be unblocked`;
}
