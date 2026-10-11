"use client";

import { Ban, CheckCircle2, Info, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Toggle } from "@/components/admin-ui";
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
  broker: Broker;
  email: string;
  accountId: string | null;
  name: string | null;
  blocked: boolean;
}
interface ClientsPage {
  page: number;
  lastPage: number;
  total: number;
  clients: BrokerClient[];
}
interface CsData {
  lastActivityAt: string | null;
  kyc: string | null;
  bank: string | null;
  deposit: string | null;
  trade: string | null;
}
interface XmData {
  lastTradeAt: string | null;
  balanceOk: boolean | null;
}

export type BulkMode = "block" | "unblock";
type Broker = "elefin" | "xm" | "coinswitch";
type Phase = "rules" | "collecting" | "review" | "applying" | "done";
type Match = "all" | "any";

const XM_BATCH = 50; // accounts per XM request (server limit)
const XM_MAX_DAYS = 365;

const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
const parseDays = (v: string, max = Infinity) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : null;
};
/** True when the date falls inside the last `days` days. No date on record never counts as recent. */
const within = (iso: string | null, days: number) => !!iso && Date.parse(iso) >= Date.now() - days * 86_400_000;
/** Same rule as the server: complete unless NOT_STARTED, PENDING, *PROGRESS*, false / 0 / no / none, or empty. */
const isDone = (s: string | null | undefined) =>
  !!s?.trim() && !/^[[{]/.test(s.trim()) && !/NOT[_\s-]?STARTED|PENDING|PROGRESS|^(false|0|no|none)$/i.test(s.trim());
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

interface Change {
  member: MemberRow;
  lastTradeAt: string | null;
  lastDepositAt?: string | null;
  balanceOk?: boolean | null;
  cs?: CsData;
}

/**
 * Bulk block (inactive members) or bulk unblock (blocked members who are active again).
 * Elefin: trade/deposit dates from the funded client list. XM: trades and balance from the XM partners API.
 */
export function BulkBlock({ mode, open, onClose, onFinished }: { mode: BulkMode; open: boolean; onClose: () => void; onFinished: () => void }) {
  const isBlock = mode === "block";
  const [broker, setBroker] = useState<Broker>("elefin");
  const [xmEnabled, setXmEnabled] = useState(false);
  const [csEnabled, setCsEnabled] = useState(false);
  const [csLastSyncAt, setCsLastSyncAt] = useState<string | null>(null);
  const [csDepositRule, setCsDepositRule] = useState(false);
  const [csTradeRule, setCsTradeRule] = useState(false);
  const [csData, setCsData] = useState<Record<string, CsData>>({});
  const [csUsingSaved, setCsUsingSaved] = useState(false);
  const [tradeDays, setTradeDays] = useState("");
  const [depositDays, setDepositDays] = useState("");
  const [balanceRule, setBalanceRule] = useState(false);
  const [match, setMatch] = useState<Match>(isBlock ? "all" : "any");
  const [phase, setPhase] = useState<Phase>("rules");
  const [progress, setProgress] = useState({ done: 0, of: 0, items: 0, totalItems: 0 });
  const [error, setError] = useState("");
  const [clients, setClients] = useState<BrokerClient[]>([]);
  const [xmData, setXmData] = useState<Record<string, XmData>>({});
  const [xmCollected, setXmCollected] = useState<{ days: number | null; balance: boolean } | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [changedCount, setChangedCount] = useState(0);
  const cancelRef = useRef(false);
  const resumeFrom = useRef(1);
  const confirm = useConfirm();
  const toast = useToast();

  const isXm = broker === "xm";
  const isCs = broker === "coinswitch";
  /** Trading days for Elefin/XM; days since last activity for CoinSwitch. */
  const trade = parseDays(tradeDays, isXm ? XM_MAX_DAYS : Infinity);
  const deposit = isXm || isCs ? null : parseDays(depositDays);
  const balance = isXm && balanceRule;
  const csDeposit = isCs && csDepositRule;
  const csTrade = isCs && csTradeRule;
  const ruleCount = [trade !== null, deposit !== null, balance, csDeposit, csTrade].filter(Boolean).length;
  const hasRule = ruleCount > 0;

  const brokerMembers = useMemo(() => (members ?? []).filter((m) => m.broker === broker), [members, broker]);
  const blockedHere = brokerMembers.filter((m) => m.blocked).length;
  /** Members this run looks at: all of the broker's members for block, only blocked ones for unblock. */
  const targets = isBlock ? brokerMembers : brokerMembers.filter((m) => m.blocked);
  const nothingToCheck = members !== null && targets.length === 0;

  useEffect(() => {
    if (!open || members !== null) return;
    api<{ members: MemberRow[]; xmEnabled: boolean; csEnabled: boolean; csLastSyncAt: string | null }>("/api/admin/bulk-block")
      .then((r) => {
        setMembers(r.members);
        setXmEnabled(r.xmEnabled);
        setCsEnabled(r.csEnabled);
        setCsLastSyncAt(r.csLastSyncAt);
      })
      .catch((e) => setError((e as Error).message));
  }, [open, members]);

  function clearCollected() {
    setPhase("rules");
    setError("");
    setClients([]);
    setXmData({});
    setXmCollected(null);
    setCsData({});
    setCsUsingSaved(false);
    setProgress({ done: 0, of: 0, items: 0, totalItems: 0 });
    resumeFrom.current = 1;
  }

  function switchBroker(b: Broker) {
    if (b === broker || phase === "collecting" || phase === "applying") return;
    setBroker(b);
    clearCollected();
  }

  function close() {
    if (phase === "applying") return;
    if (phase === "collecting") cancelRef.current = true;
    clearCollected();
    setMembers(null);
    onClose();
  }

  async function collect() {
    if (!hasRule || nothingToCheck) return;
    cancelRef.current = false;
    setError("");
    setPhase("collecting");
    try {
      if (isXm) await collectXm();
      else if (isCs) await collectCs();
      else await collectElefin();
      if (!cancelRef.current) setPhase("review");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Every page of Elefin's funded clients (200 per page), resuming after an error. */
  async function collectElefin() {
    let page = resumeFrom.current;
    let lastPage = Math.max(page, progress.of || page);
    while (page <= lastPage) {
      if (cancelRef.current) return;
      const r = await api<ClientsPage>(`/api/admin/bulk-block/clients?page=${page}`);
      lastPage = r.lastPage;
      setClients((list) => [...list, ...r.clients]);
      setProgress((p) => ({ done: page, of: lastPage, items: p.items + r.clients.length, totalItems: r.total }));
      page++;
      resumeFrom.current = page;
    }
  }

  /** XM: only our XM members, 50 accounts per request, resuming after an error. */
  async function collectXm() {
    const ids = targets.map((m) => m.accountId!).filter(Boolean);
    const batches = Math.ceil(ids.length / XM_BATCH);
    if (resumeFrom.current === 1) {
      setXmData({});
      setProgress({ done: 0, of: batches, items: 0, totalItems: ids.length });
    }
    for (let b = resumeFrom.current; b <= batches; b++) {
      if (cancelRef.current) return;
      const chunk = ids.slice((b - 1) * XM_BATCH, b * XM_BATCH);
      const r = await api<{ lastTradeAt: Record<string, string | null> | null; balance: Record<string, boolean> | null }>("/api/admin/bulk-block/xm", {
        body: { loginIds: chunk, days: trade, balance },
      });
      setXmData((d) => {
        const next = { ...d };
        for (const id of chunk) next[id] = { lastTradeAt: r.lastTradeAt?.[id] ?? null, balanceOk: r.balance ? (r.balance[id] ?? null) : null };
        return next;
      });
      setProgress({ done: b, of: batches, items: Math.min(b * XM_BATCH, ids.length), totalItems: ids.length });
      resumeFrom.current = b + 1;
    }
    setXmCollected({ days: trade, balance });
  }

  /** CoinSwitch: refresh the server-side lead list page by page (500 per page), then read our members' leads. */
  async function collectCs() {
    let page = resumeFrom.current - 1;
    let totalPages = Math.max(page + 1, progress.of || page + 1);
    while (page < totalPages) {
      if (cancelRef.current) return;
      const r = await api<{ totalPages: number; totalLeads: number; count: number }>("/api/admin/coinswitch/sync", { body: { page } });
      totalPages = r.totalPages;
      page++;
      resumeFrom.current = page + 1;
      setProgress((p) => ({ done: page, of: totalPages, items: p.items + r.count, totalItems: r.totalLeads }));
    }
    await loadCsLeads();
  }

  async function loadCsLeads() {
    const r = await api<{ leads: Record<string, CsData> }>("/api/admin/coinswitch/leads");
    setCsData(r.leads);
  }

  /** When CoinSwitch can't be reached (e.g. expired token), carry on with the lead list already saved on the server. */
  async function useSavedLeads() {
    try {
      await loadCsLeads();
      setCsUsingSaved(true);
      setError("");
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** XM data depends on the window and balance rule it was fetched with; a longer window needs fetching again. */
  const xmStale =
    isXm &&
    phase === "review" &&
    xmCollected !== null &&
    ((trade !== null && (xmCollected.days === null || trade > xmCollected.days)) || (balance && !xmCollected.balance));

  // Classify members by the current rules. Runs live, so editing the rules on the review step recounts instantly.
  const result = useMemo(() => {
    const toChange: Change[] = [];
    let unchanged = 0; // block: active members (safe) · unblock: blocked members who stay blocked
    let alreadyBlocked = 0;
    let notRegistered = 0;
    let notInBrokerList = 0;
    const combine = (checks: boolean[]) => checks.length > 0 && (match === "all" ? checks.every(Boolean) : checks.some(Boolean));

    if (isCs) {
      for (const m of targets) {
        const d = csData[m.accountId ?? ""];
        if (!d) {
          notInBrokerList++;
          continue;
        }
        const checks: boolean[] = [];
        if (trade !== null) checks.push(isBlock ? !within(d.lastActivityAt, trade) : within(d.lastActivityAt, trade));
        if (csDeposit) checks.push(isBlock ? !isDone(d.deposit) : isDone(d.deposit));
        if (csTrade) checks.push(isBlock ? !isDone(d.trade) : isDone(d.trade));
        if (!combine(checks)) unchanged++;
        else if (isBlock && m.blocked) alreadyBlocked++;
        else toChange.push({ member: m, lastTradeAt: d.lastActivityAt, cs: d });
      }
      return { toChange, unchanged, alreadyBlocked, notRegistered, notInBrokerList, checked: targets.length };
    }

    if (isXm) {
      for (const m of targets) {
        const d = xmData[m.accountId ?? ""] ?? { lastTradeAt: null, balanceOk: null };
        const checks: boolean[] = [];
        if (trade !== null) checks.push(isBlock ? !within(d.lastTradeAt, trade) : within(d.lastTradeAt, trade));
        // An unknown balance (XM didn't return the account) never counts as a match.
        if (balance) checks.push(d.balanceOk === null ? false : isBlock ? !d.balanceOk : d.balanceOk);
        if (!combine(checks)) unchanged++;
        else if (isBlock && m.blocked) alreadyBlocked++;
        else toChange.push({ member: m, lastTradeAt: d.lastTradeAt, balanceOk: d.balanceOk });
      }
      return { toChange, unchanged, alreadyBlocked, notRegistered, notInBrokerList, checked: targets.length };
    }

    // Elefin: one record per email, using the most recent trade/deposit across duplicate client records.
    const byEmail = new Map<string, BrokerClient>();
    for (const c of clients) {
      if (!c.email) continue;
      const prev = byEmail.get(c.email);
      byEmail.set(
        c.email,
        prev ? { ...prev, lastTradeAt: later(prev.lastTradeAt, c.lastTradeAt), lastDepositAt: later(prev.lastDepositAt, c.lastDepositAt) } : c
      );
    }
    const matches = (c: BrokerClient) => {
      const checks: boolean[] = [];
      if (trade !== null) checks.push(isBlock ? !within(c.lastTradeAt, trade) : within(c.lastTradeAt, trade));
      if (deposit !== null) checks.push(isBlock ? !within(c.lastDepositAt, deposit) : within(c.lastDepositAt, deposit));
      return combine(checks);
    };
    if (isBlock) {
      const memberByEmail = new Map(brokerMembers.map((m) => [m.email, m]));
      for (const c of byEmail.values()) {
        const m = memberByEmail.get(c.email);
        if (!m) notRegistered++;
        else if (!matches(c)) unchanged++;
        else if (m.blocked) alreadyBlocked++;
        else toChange.push({ member: m, lastTradeAt: c.lastTradeAt, lastDepositAt: c.lastDepositAt });
      }
      notInBrokerList = brokerMembers.filter((m) => !byEmail.has(m.email)).length;
    } else {
      for (const m of targets) {
        const c = byEmail.get(m.email);
        if (!c) notInBrokerList++;
        else if (matches(c)) toChange.push({ member: m, lastTradeAt: c.lastTradeAt, lastDepositAt: c.lastDepositAt });
        else unchanged++;
      }
    }
    return { toChange, unchanged, alreadyBlocked, notRegistered, notInBrokerList, checked: byEmail.size };
  }, [isXm, isCs, xmData, csData, targets, brokerMembers, clients, trade, deposit, balance, csDeposit, csTrade, match, isBlock]);

  async function apply() {
    const n = result.toChange.length;
    const ok = await confirm({
      title: `${isBlock ? "Block" : "Unblock"} ${plural(n, `${isXm || isCs ? `${brokerName} ` : ""}member`)}?`,
      message: (
        <>
          {ruleSummary(mode, trade, deposit, balance, match, { cs: isCs, csDeposit, csTrade })}.{" "}
          {isBlock
            ? "Blocked members can’t verify or receive videos until you unblock them."
            : "They’ll be able to verify and request videos again."}{" "}
          {plural(result.unchanged, "member")} will {isBlock ? "stay active" : "stay blocked"}.
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

  const pct = progress.of ? Math.round((progress.done / progress.of) * 100) : 0;
  const verb = isBlock ? "Block" : "Unblock";
  const busy = phase === "collecting" || phase === "applying";
  const brokerName = isXm ? "XM" : isCs ? "CoinSwitch" : "Elefin";
  const memberWord = (m: MemberRow) =>
    m.broker === "xm" ? `XM account ${m.accountId}` : m.broker === "coinswitch" ? `CoinSwitch client ${m.accountId}` : m.email;
  const enabledBrokers = (["elefin", "xm", "coinswitch"] as const).filter((b) => b === "elefin" || (b === "xm" && xmEnabled) || (b === "coinswitch" && csEnabled));
  const toggleRow = (label: string, checked: boolean, set: (v: boolean) => void) => (
    <div key={label} className="flex items-center gap-3 rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2">
      <span className="flex-1 text-[13px] text-[#d4d7de]">{label}</span>
      <Toggle checked={checked} onChange={set} disabled={busy} />
    </div>
  );

  const dayRow = (label: string, value: string, set: (v: string) => void, max?: number) => (
    <div key={label} className="flex items-center gap-3 rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2">
      <span className="flex-1 text-[13px] text-[#d4d7de]">{label}</span>
      <input className="input w-[90px] text-right" type="number" min={1} max={max} placeholder="Off" value={value} onChange={(e) => set(e.target.value)} disabled={busy} />
      <span className="w-8 text-[13px] text-[#8b919d]">days</span>
    </div>
  );

  const rulesEditor = (
    <div className="space-y-2">
      {dayRow(
        isCs ? (isBlock ? "No activity in the last" : "Active in the last") : isBlock ? "Hasn’t traded in the last" : "Traded in the last",
        tradeDays,
        setTradeDays,
        isXm ? XM_MAX_DAYS : undefined
      )}
      {isCs ? (
        <>
          {toggleRow(isBlock ? "Hasn’t deposited yet" : "Has deposited", csDepositRule, setCsDepositRule)}
          {toggleRow(isBlock ? "Hasn’t traded yet" : "Has traded", csTradeRule, setCsTradeRule)}
        </>
      ) : isXm ? (
        <div className="flex items-center gap-3 rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2">
          <span className="flex-1 text-[13px] text-[#d4d7de]">
            {isBlock ? "Balance is below XM’s threshold" : "Balance is at or above XM’s threshold"}
          </span>
          <Toggle checked={balanceRule} onChange={setBalanceRule} disabled={busy} />
        </div>
      ) : (
        dayRow(isBlock ? "Hasn’t deposited in the last" : "Deposited in the last", depositDays, setDepositDays)
      )}
      {ruleCount >= 2 && (
        <div className="flex items-center justify-between gap-3 rounded-[5px] border border-[#262a33] px-3 py-2">
          <span className="text-[13px] text-[#d4d7de]">{verb} a member when</span>
          <div className="flex rounded-[5px] border border-[#323743] p-0.5">
            {(
              [
                ["all", ruleCount > 2 ? "All rules match" : "Both rules match"],
                ["any", ruleCount > 2 ? "Any rule matches" : "Either rule matches"],
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
        {isCs
          ? "Leave the days empty or a switch off to skip that rule. At least one rule is required. CoinSwitch only shares the last activity date and step statuses (no trade or deposit dates). Members with no activity on record count as inactive."
          : isXm
          ? `Leave the days empty or the balance rule off to skip it. At least one rule is required. Trading is checked over up to ${XM_MAX_DAYS} days. XM doesn’t share deposit history, so there’s no deposit rule for XM; the balance rule uses the threshold XM set for your partner account.`
          : `Leave a rule empty to skip it. At least one rule is required. ${
              isBlock ? "Members with no trade or deposit on record count as inactive." : "Members with no trade or deposit on record don’t meet that rule."
            }`}
      </p>
    </div>
  );

  const notice = (text: React.ReactNode) => (
    <div className="flex items-start gap-2 rounded-[5px] border border-[#2b3a5c] bg-[#121a2c] px-3 py-2.5 text-[13px] text-[#a9c1ff]">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{text}</div>
    </div>
  );

  const stats = isBlock
    ? [
        { label: "Will be blocked", value: result.toChange.length, cls: "text-[#f19aa5]" },
        { label: "Safe (active)", value: result.unchanged, cls: "text-[#6fd99a]" },
        isCs
          ? { label: "Not in CoinSwitch leads", value: result.notInBrokerList, cls: "text-[#b4b9c4]" }
          : isXm
            ? { label: "XM members checked", value: result.checked, cls: "text-[#b4b9c4]" }
            : { label: "Not registered here", value: result.notRegistered, cls: "text-[#b4b9c4]" },
        { label: "Already blocked", value: result.alreadyBlocked, cls: "text-[#b4b9c4]" },
      ]
    : [
        { label: "Will be unblocked", value: result.toChange.length, cls: "text-[#6fd99a]" },
        { label: "Stay blocked", value: result.unchanged, cls: "text-[#f19aa5]" },
        isXm
          ? { label: "Blocked XM members", value: blockedHere, cls: "text-[#b4b9c4]" }
          : { label: `Not in ${brokerName} ${isCs ? "leads" : "list"}`, value: result.notInBrokerList, cls: "text-[#b4b9c4]" },
        { label: "Blocked in total", value: (members ?? []).filter((m) => m.blocked).length, cls: "text-[#b4b9c4]" },
      ];

  const emptyText = isBlock
    ? `There are no ${brokerName} members yet.`
    : `No ${brokerName} members have been blocked, so there’s nobody to unblock.`;

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
              {nothingToCheck ? "Close" : "Cancel"}
            </button>
            {!nothingToCheck && (
              <button className="btn btn-primary" onClick={collect} disabled={!hasRule || members === null}>
                Collect data from {brokerName}
              </button>
            )}
          </>
        ) : phase === "collecting" ? (
          <>
            <button className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
            {error && isCs && (
              <button className="btn btn-secondary" onClick={useSavedLeads}>
                Continue with saved lead list
              </button>
            )}
            {error && (
              <button className="btn btn-primary" onClick={collect}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry from {isXm ? "batch" : "page"} {isCs ? resumeFrom.current - 1 : resumeFrom.current}
              </button>
            )}
          </>
        ) : phase === "review" || phase === "applying" ? (
          <>
            <button className="btn btn-secondary" onClick={close} disabled={phase === "applying"}>
              Cancel
            </button>
            {xmStale ? (
              <button
                className="btn btn-primary"
                onClick={() => {
                  resumeFrom.current = 1;
                  collect();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Collect again
              </button>
            ) : (
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
            )}
          </>
        ) : (
          <button className="btn btn-primary" onClick={close}>
            Close
          </button>
        )
      }
    >
      {enabledBrokers.length > 1 && phase !== "done" && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-[13px] text-[#b4b9c4]">Broker</span>
          <div className="flex rounded-[5px] border border-[#323743] p-0.5">
            {enabledBrokers.map((b) => (
              <button
                key={b}
                type="button"
                disabled={busy}
                onClick={() => switchBroker(b)}
                className={`h-7 rounded-[3px] px-3 text-[12px] font-medium disabled:opacity-50 ${broker === b ? "bg-[#232833] text-white" : "text-[#8b919d] hover:text-[#d4d7de]"}`}
              >
                {b === "xm" ? "XM" : b === "coinswitch" ? "CoinSwitch" : "Elefin"}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "rules" &&
        (members === null && !error ? (
          <div className="flex items-center gap-2 py-6 text-[#8b919d]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
          </div>
        ) : nothingToCheck ? (
          notice(emptyText)
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-[#8b919d]">
              {isBlock && isCs
                ? `Block CoinSwitch members who have gone inactive. We’ll refresh your CoinSwitch lead list (500 leads per page) and check your ${plural(targets.length, "CoinSwitch member")} against it before anything is blocked.`
                : isBlock
                ? isXm
                  ? `Block XM members who have gone inactive. We’ll check your ${plural(targets.length, "XM member")} with the XM partners API and show the result before anything is blocked.`
                  : "Block members who have gone inactive at Elefin. We’ll load every funded client from Elefin, match them to members by email, and show the result before anything is blocked."
                : `Unblock ${brokerName} members who are active again. ${
                    blockedHere === 1 ? "1 member is" : `${fmt(blockedHere)} members are`
                  } blocked right now. We’ll check them with ${brokerName} and show who qualifies before anything changes.`}
            </p>
            {rulesEditor}
            {error && <p className="rounded-[5px] border border-[#4a2429] bg-[#2a1518] px-3 py-2 text-[12px] text-[#f5b8c0]">{error}</p>}
          </div>
        ))}

      {phase === "collecting" && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="flex items-center gap-2 text-[#d4d7de]">
              {!error && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Collecting data from {brokerName}…
            </span>
            <span className="tabular-nums text-[#8b919d]">
              {progress.of
                ? isXm
                  ? `Batch ${fmt(progress.done)} of ${fmt(progress.of)} · ${fmt(progress.items)} of ${fmt(progress.totalItems)} accounts`
                  : `Page ${fmt(progress.done)} of ${fmt(progress.of)} · ${fmt(progress.items)} of ${fmt(progress.totalItems)} clients`
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
          ) : xmStale ? (
            notice("These rules need data that hasn’t been loaded yet (a longer trading window or the balance rule). Click Collect again to update.")
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
                  isBlock
                    ? "No active members match these rules, so nobody will be blocked. Try different rules."
                    : "No blocked members meet these rules, so nobody will be unblocked. Try fewer days or a different rule."
                )}

              <p className="text-[12px] text-[#7d8390]">
                {isCs ? (
                  <>
                    Checked {plural(result.checked, "CoinSwitch member")} against your CoinSwitch lead list
                    {csUsingSaved ? ` saved ${csLastSyncAt ? fmtDate(csLastSyncAt) : "earlier"} (CoinSwitch couldn’t be reached)` : ""}.
                    {result.notInBrokerList > 0 && ` ${plural(result.notInBrokerList, "member")} ${result.notInBrokerList === 1 ? "isn’t" : "aren’t"} in the leads and won’t be changed.`}
                  </>
                ) : isXm ? (
                  <>Checked {plural(result.checked, "XM account")} with the XM partners API.</>
                ) : isBlock ? (
                  <>
                    Checked {fmt(result.checked)} funded Elefin clients against {plural(brokerMembers.length, "Elefin member")}. &ldquo;Not registered
                    here&rdquo; are Elefin clients who never verified on this site.
                    {result.notInBrokerList > 0 &&
                      ` ${plural(result.notInBrokerList, "member")} ${result.notInBrokerList === 1 ? "isn’t" : "aren’t"} in Elefin’s funded list and won’t be changed.`}
                  </>
                ) : (
                  <>
                    Checked {plural(targets.length, "blocked member")} against {fmt(result.checked)} funded Elefin clients.
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
                          <th className="w-[170px]">{isCs ? "Last activity" : "Last trade"}</th>
                          <th className="w-[170px]">{isCs ? "Deposit · Trade" : isXm ? "Balance" : "Last deposit"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.toChange.slice(0, 300).map((x) => (
                          <tr key={x.member.id}>
                            <td>
                              <div className="truncate text-[#eceef2]">{x.member.name || memberWord(x.member)}</div>
                              {x.member.name && <div className="truncate text-[12px] text-[#7d8390]">{memberWord(x.member)}</div>}
                            </td>
                            <td className="text-[#8b919d]">
                              {x.lastTradeAt ? fmtDate(x.lastTradeAt) : isXm && trade !== null ? `None in ${trade} days` : isXm ? "—" : "Never"}
                            </td>
                            <td className="text-[#8b919d]">
                              {isCs
                                ? `${isDone(x.cs?.deposit) ? "Deposited" : "No deposit"} · ${isDone(x.cs?.trade) ? "Traded" : "No trade"}`
                                : isXm
                                ? x.balanceOk === null || x.balanceOk === undefined
                                  ? "—"
                                  : x.balanceOk
                                    ? "Above threshold"
                                    : "Below threshold"
                                : x.lastDepositAt
                                  ? fmtDate(x.lastDepositAt)
                                  : "Never"}
                            </td>
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

function ruleSummary(
  mode: BulkMode,
  trade: number | null,
  deposit: number | null,
  balance: boolean,
  match: Match,
  cs: { cs: boolean; csDeposit: boolean; csTrade: boolean } = { cs: false, csDeposit: false, csTrade: false }
) {
  const block = mode === "block";
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const parts = [
    trade !== null && (cs.cs ? `${block ? "no" : ""} activity in the last ${days(trade)}`.trim() : `${block ? "no" : "a"} trade in the last ${days(trade)}`),
    cs.csDeposit && (block ? "no deposit yet" : "a deposit"),
    cs.csTrade && (block ? "no trade yet" : "a trade"),
    deposit !== null && `${block ? "no" : "a"} deposit in the last ${deposit} day${deposit === 1 ? "" : "s"}`,
    balance && (block ? "a balance below XM’s threshold" : "a balance at or above XM’s threshold"),
  ].filter(Boolean) as string[];
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ${match === "all" ? "and" : "or"} ${parts.at(-1)}` : parts[0];
  return block ? `Members with ${joined} will be blocked` : `Blocked members with ${joined} will be unblocked`;
}
