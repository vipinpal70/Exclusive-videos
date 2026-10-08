"use client";

import { AlertTriangle, CheckCircle2, Loader2, Send, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Toggle } from "@/components/admin-ui";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";

type Item = [number, number];
interface Plan {
  items: Item[];
  recipients: number;
  linkedMembers: number;
  videos: number;
}
interface ItemResult {
  memberId: number;
  videoId: number;
  status: "sent" | "failed" | "unreachable" | "skipped";
  error?: string;
}

const BATCH_SIZE = 20; // messages per batch
const BATCH_INTERVAL_MS = 1000; // one batch per second → 20 messages/second

type Phase = "setup" | "running" | "done";

const fmt = (n: number) => n.toLocaleString();
function duration(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m < 60 ? `${m} min${s ? ` ${s} s` : ""}` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function BulkSend({ open, onClose, onFinished }: { open: boolean; onClose: () => void; onFinished: () => void }) {
  const [sendAll, setSendAll] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState("");
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [done, setDone] = useState(0);
  const [counts, setCounts] = useState({ sent: 0, failed: 0, unreachable: 0, skipped: 0 });
  const [issues, setIssues] = useState<ItemResult[]>([]);
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);
  const stopRef = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();
  const running = phase === "running";

  const loadPlan = useCallback(async (all: boolean) => {
    setLoadingPlan(true);
    setPlanError("");
    try {
      setPlan(await api<Plan>(`/api/admin/broadcast?mode=${all ? "all" : "new"}`));
    } catch (e) {
      setPlan(null);
      setPlanError((e as Error).message);
    } finally {
      setLoadingPlan(false);
    }
  }, []);

  // Fresh preview each time the dialog opens or the toggle changes.
  useEffect(() => {
    if (open && phase === "setup") loadPlan(sendAll);
  }, [open, sendAll, phase, loadPlan]);

  // Reset when closed.
  useEffect(() => {
    if (open) return;
    setPhase("setup");
    setPlan(null);
    setDone(0);
    setCounts({ sent: 0, failed: 0, unreachable: 0, skipped: 0 });
    setIssues([]);
    setStopped(false);
  }, [open]);

  // While sending: warn before closing the tab, and intercept the back button and in-app links.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // the browser shows its own "Leave site?" prompt
    };
    const askToLeave = async () =>
      confirm({
        title: "Sending is still in progress",
        message: "Please stay on this page until the bulk send finishes. Leaving now stops it, and the remaining members won't get their videos.",
        confirmLabel: "Stop and leave",
        danger: true,
      });
    const onPopState = async () => {
      window.history.pushState({ bulkSend: true }, ""); // stay on the page
      if (await askToLeave()) {
        stopRef.current = true;
        window.history.go(-2);
      }
    };
    const onClick = async (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (await askToLeave()) {
        stopRef.current = true;
        window.location.assign(a.href);
      }
    };
    window.history.pushState({ bulkSend: true }, "");
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onClick, true);
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClick, true);
      clearInterval(timer);
    };
  }, [running, confirm]);

  async function start() {
    if (!plan || !plan.items.length) return;
    const ok = await confirm({
      title: "Start bulk send?",
      message: (
        <>
          <span className="text-[#eceef2]">{fmt(plan.recipients)}</span> member{plan.recipients === 1 ? "" : "s"} will receive{" "}
          <span className="text-[#eceef2]">{fmt(plan.items.length)}</span> video message{plan.items.length === 1 ? "" : "s"} in total
          {sendAll ? ", including videos they already received" : ", only videos they haven’t received yet"}. This takes about{" "}
          {duration(Math.ceil(plan.items.length / BATCH_SIZE) * (BATCH_INTERVAL_MS / 1000))}. Keep this tab open until it finishes.
        </>
      ),
      confirmLabel: `Send to ${fmt(plan.recipients)} member${plan.recipients === 1 ? "" : "s"}`,
    });
    if (!ok) return;

    stopRef.current = false;
    setStopping(false);
    setStopped(false);
    setDone(0);
    setCounts({ sent: 0, failed: 0, unreachable: 0, skipped: 0 });
    setIssues([]);
    setStartedAt(Date.now());
    setPhase("running");

    const items = plan.items;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      if (stopRef.current) {
        setStopped(true);
        break;
      }
      const batchStart = Date.now();
      const batch = items.slice(i, i + BATCH_SIZE);
      let results: ItemResult[];
      try {
        results = (await api<{ results: ItemResult[] }>("/api/admin/broadcast/send", { body: { items: batch } })).results;
      } catch (e) {
        // A whole batch failed (network or server error): record it and keep going.
        results = batch.map(([memberId, videoId]) => ({ memberId, videoId, status: "failed", error: (e as Error).message }));
      }
      setDone((d) => d + batch.length);
      setCounts((c) => {
        const n = { ...c };
        for (const r of results) n[r.status]++;
        return n;
      });
      const bad = results.filter((r) => r.status !== "sent");
      if (bad.length) setIssues((list) => [...bad, ...list].slice(0, 50));

      const wait = BATCH_INTERVAL_MS - (Date.now() - batchStart);
      if (wait > 0 && i + BATCH_SIZE < items.length) await new Promise((r) => setTimeout(r, wait));
    }

    setPhase("done");
    onFinished();
    toast(stopRef.current ? "Bulk send stopped." : "Bulk send finished.", stopRef.current ? "info" : "success");
  }

  async function stop() {
    const ok = await confirm({
      title: "Stop bulk send?",
      message: "Messages already sent stay sent. The remaining members won't get their videos from this run.",
      confirmLabel: "Stop sending",
      danger: true,
    });
    if (ok) {
      stopRef.current = true;
      setStopping(true);
    }
  }

  const total = plan?.items.length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  const rate = elapsed > 0 ? done / elapsed : 0;
  const remaining = rate > 0 ? (total - done) / rate : 0;

  return (
    <Modal
      open={open}
      onClose={running ? () => toast("Sending is in progress. Stop it first, or wait until it finishes.", "info") : onClose}
      title="Bulk send videos"
      wide
      footer={
        phase === "setup" ? (
          <>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={start} disabled={loadingPlan || !plan || plan.items.length === 0}>
              <Send className="h-3.5 w-3.5" /> Review and send
            </button>
          </>
        ) : phase === "running" ? (
          <button className="btn btn-danger" onClick={stop} disabled={stopping}>
            <Square className="h-3.5 w-3.5" /> {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      {phase === "setup" ? (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium text-[#eceef2]">Send all videos</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[#7d8390]">
                {sendAll
                  ? "On: every active video goes to every member, including videos they already received. Cooldowns are ignored."
                  : "Off: each member only gets the videos they haven’t received yet."}
              </span>
            </span>
            <Toggle checked={sendAll} onChange={setSendAll} />
          </label>

          <div className="rounded-[5px] border border-[#262a33]">
            <div className="border-b border-[#262a33] bg-[#13161b] px-3 py-2 text-[12px] font-medium text-[#b4b9c4]">Who will receive videos</div>
            {loadingPlan ? (
              <div className="flex items-center gap-2 px-3 py-4 text-[#8b919d]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting recipients…
              </div>
            ) : planError ? (
              <p className="px-3 py-4 text-[#f19aa5]">{planError}</p>
            ) : plan ? (
              <div className="grid grid-cols-2 divide-x divide-[#20242c] sm:grid-cols-4">
                {[
                  { label: "Members receiving", value: plan.recipients, strong: true },
                  { label: "Video messages", value: plan.items.length, strong: true },
                  { label: "Linked & eligible", value: plan.linkedMembers },
                  { label: "Active videos", value: plan.videos },
                ].map((s) => (
                  <div key={s.label} className="px-3 py-3">
                    <div className="text-[12px] text-[#7d8390]">{s.label}</div>
                    <div className={`mt-0.5 text-[20px] font-semibold tabular-nums ${s.strong ? "text-[#f2f3f6]" : "text-[#b4b9c4]"}`}>{fmt(s.value)}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {plan && !loadingPlan && plan.items.length === 0 && (
            <p className="text-[13px] text-[#8b919d]">
              {plan.linkedMembers === 0
                ? "No eligible members have Telegram linked yet."
                : "Everyone already has every video. Turn on Send all videos to send them again."}
            </p>
          )}
          {plan && plan.items.length > 0 && (
            <p className="text-[12px] text-[#7d8390]">
              Sent at {BATCH_SIZE} messages per second (about {duration(Math.ceil(plan.items.length / BATCH_SIZE))}). Only members who are eligible, not
              blocked and have Telegram linked are included. You&apos;ll need to keep this tab open while it runs.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {running && (
            <div className="flex items-start gap-2 rounded-[5px] border border-[#5c4a1f] bg-[#2a2211] px-3 py-2.5 text-[13px] text-[#f5d58a]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Don&apos;t close this tab or go back until sending finishes. Leaving stops the bulk send.
            </div>
          )}
          {phase === "done" && (
            <div className="flex items-start gap-2 rounded-[5px] border border-[#1d4430] bg-[#0f2418] px-3 py-2.5 text-[13px] text-[#8fe3b0]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              {stopped ? `Stopped after ${fmt(done)} of ${fmt(total)} messages.` : `Finished: ${fmt(total)} messages processed in ${duration(elapsed)}.`}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span className="text-[#d4d7de]">
                {fmt(done)} of {fmt(total)} messages
              </span>
              <span className="tabular-nums text-[#8b919d]">
                {pct}%{running && rate > 0 && ` · ${rate.toFixed(1)}/s · about ${duration(remaining)} left`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#232833]">
              <div className={`h-full rounded-full transition-all duration-500 ${phase === "done" ? "bg-[#3ecf7a]" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Sent", value: counts.sent, cls: "text-[#6fd99a]" },
              { label: "Failed", value: counts.failed, cls: "text-[#f19aa5]" },
              { label: "Bot not started", value: counts.unreachable, cls: "text-[#f5d58a]" },
              { label: "Skipped", value: counts.skipped, cls: "text-[#b4b9c4]" },
            ].map((c) => (
              <div key={c.label} className="rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2">
                <div className="text-[12px] text-[#7d8390]">{c.label}</div>
                <div className={`text-[18px] font-semibold tabular-nums ${c.cls}`}>{fmt(c.value)}</div>
              </div>
            ))}
          </div>

          {issues.length > 0 && (
            <div className="overflow-hidden rounded-[5px] border border-[#262a33]">
              <div className="border-b border-[#262a33] bg-[#13161b] px-3 py-2 text-[12px] font-medium text-[#b4b9c4]">
                Recent problems <span className="font-normal text-[#7d8390]">(full details in Activity logs)</span>
              </div>
              <ul className="max-h-40 divide-y divide-[#20242c] overflow-y-auto">
                {issues.map((r, i) => (
                  <li key={i} className="px-3 py-1.5 text-[12px]">
                    <span className="text-[#d4d7de]">Member #{r.memberId}</span> <span className="text-[#7d8390]">· video #{r.videoId}</span>
                    <span className="ml-2 text-[#f19aa5]">{r.error ?? r.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {counts.unreachable > 0 && (
            <p className="text-[12px] text-[#7d8390]">
              &ldquo;Bot not started&rdquo; members didn&apos;t allowed the bot to send message whiile connecting or have blocked it. They can still get their videos from the website manually.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
