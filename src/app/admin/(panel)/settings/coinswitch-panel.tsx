"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dot, Modal } from "@/components/admin-ui";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { api, fmtDate, timeAgo } from "@/lib/api";

interface CsStatus {
  connected: boolean;
  expired: boolean;
  expiresAt: string | null;
  phone: string;
  leadsCached: number;
  lastSyncAt: string | null;
  statuses: { field: string; value: string; count: number }[];
}

type Step = "phone" | "otp" | "pin";

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h} h ${m} min left` : `${m} min left`;
}

/** CoinSwitch partner login (phone → OTP → PIN) and the lead list sync, both used only by bulk block / unblock. */
export function CoinSwitchPanel({ editable }: { editable: boolean }) {
  const [status, setStatus] = useState<CsStatus | null>(null);
  const [step, setStep] = useState<Step>("phone");
  const [loggingIn, setLoggingIn] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<{ page: number; totalPages: number; leads: number; total: number } | null>(null);
  const [, tick] = useState(0);
  const stopSync = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => {
    api<CsStatus>("/api/admin/coinswitch")
      .then((s) => {
        setStatus(s);
        setPhone((p) => p || s.phone);
      })
      .catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  async function call(body: Record<string, string>, next?: Step) {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/admin/coinswitch/auth", { body });
      toast(r.message, "success");
      if (next) setStep(next);
      else {
        setLoggingIn(false);
        setStep("phone");
        setOtp("");
        setPin("");
      }
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const stepReady =
    step === "phone" ? phone.replace(/\D/g, "").length >= 10 : step === "otp" ? otp.length >= 4 : pin.length >= 4;

  function closeLogin() {
    if (busy) return;
    setLoggingIn(false);
    setStep("phone");
    setOtp("");
    setPin("");
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Remove the CoinSwitch partner login?",
      message: "Bulk block / unblock for CoinSwitch will only be able to use the saved lead list until you log in again. Website verification isn’t affected.",
      confirmLabel: "Remove login",
      danger: true,
    });
    if (ok) call({ step: "disconnect" });
  }

  /** Page through the lead list (500 per page) with progress. */
  async function runSync() {
    stopSync.current = false;
    setSync({ page: 0, totalPages: 0, leads: 0, total: 0 });
    try {
      let page = 0;
      let totalPages = 1;
      let leads = 0;
      while (page < totalPages && !stopSync.current) {
        const r = await api<{ totalPages: number; totalLeads: number; count: number }>("/api/admin/coinswitch/sync", { body: { page } });
        totalPages = r.totalPages;
        leads += r.count;
        page++;
        setSync({ page, totalPages, leads, total: r.totalLeads });
      }
      toast(stopSync.current ? "Lead sync stopped." : `Synced ${leads.toLocaleString()} CoinSwitch leads.`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSync(null);
      load();
    }
  }

  if (!status) return null;
  const tone = !status.connected ? "muted" : status.expired ? "error" : "ok";
  const label = !status.connected ? "Not connected" : status.expired ? "Login expired" : `Connected · ${timeLeft(status.expiresAt!)}`;
  const statusFields = ["kyc", "bank", "deposit", "trade"].map((f) => ({ f, values: status.statuses.filter((s) => s.field === f) }));

  return (
    <div className="space-y-3 border-b border-[#262a33] px-4 py-3">
      {/* Token */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#eceef2]">
            Partner login
            <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-[#b4b9c4]">
              <Dot tone={tone} /> {label}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[#7d8390]">
            {status.connected && status.expiresAt
              ? `Expires ${fmtDate(status.expiresAt)}. Only used to fetch your leads for bulk block / unblock; website verification doesn’t need it.`
              : "Only needed for bulk block / unblock, to fetch your affiliate leads. Log in with your CoinSwitch partner phone number, the SMS code and your PIN. The PIN is never saved."}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 gap-2">
            {status.connected && (
              <button className="btn btn-secondary btn-sm" onClick={disconnect} disabled={busy}>
                Remove
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setLoggingIn(true)}>
              {status.connected ? "Log in again" : "Log in"}
            </button>
          </div>
        )}
      </div>

      <Modal
        open={loggingIn}
        onClose={closeLogin}
        title="CoinSwitch partner login"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeLogin} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="cs-login" className="btn btn-primary" disabled={busy || !stepReady}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {step === "phone" ? "Send OTP" : step === "otp" ? "Verify code" : "Log in"}
            </button>
          </>
        }
      >
        <form
          id="cs-login"
          onSubmit={(e) => {
            e.preventDefault();
            if (!stepReady || busy) return;
            if (step === "phone") call({ step: "otp", phone }, "otp");
            else if (step === "otp") call({ step: "verify", otp }, "pin");
            else call({ step: "pin", pin });
          }}
          className="space-y-4"
        >
          <ol className="grid grid-cols-3 gap-2">
            {(["phone", "otp", "pin"] as const).map((st, i) => {
              const idx = ["phone", "otp", "pin"].indexOf(step);
              const state = i < idx ? "done" : i === idx ? "current" : "next";
              return (
                <li key={st} className="flex items-center gap-2 text-[12px]">
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                      state === "done" ? "bg-[#12301f] text-[#6fd99a]" : state === "current" ? "bg-brand-600 text-white" : "bg-[#232833] text-[#7d8390]"
                    }`}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <span className={state === "current" ? "font-medium text-white" : "text-[#7d8390]"}>
                    {st === "phone" ? "Phone" : st === "otp" ? "SMS code" : "PIN"}
                  </span>
                </li>
              );
            })}
          </ol>

          {step === "phone" && (
            <div>
              <label className="label" htmlFor="cs-phone-in">
                Partner phone number
              </label>
              <input
                id="cs-phone-in"
                className="input"
                type="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
              />
              <p className="hint">The phone number registered with your CoinSwitch partner account. CoinSwitch will text it a one-time code.</p>
            </div>
          )}
          {step === "otp" && (
            <div>
              <label className="label" htmlFor="cs-otp-in">
                SMS code
              </label>
              <input
                id="cs-otp-in"
                className="input w-[160px] tracking-widest"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
              <p className="hint">
                Sent to {phone}.{" "}
                <button type="button" className="text-brand-300 hover:underline disabled:opacity-50" disabled={busy} onClick={() => call({ step: "otp", phone }, "otp")}>
                  Resend code
                </button>{" "}
                ·{" "}
                <button type="button" className="text-brand-300 hover:underline" disabled={busy} onClick={() => setStep("phone")}>
                  Change number
                </button>
              </p>
            </div>
          )}
          {step === "pin" && (
            <div>
              <label className="label" htmlFor="cs-pin-in">
                CoinSwitch PIN
              </label>
              <input
                id="cs-pin-in"
                className="input w-[160px] tracking-widest"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
              <p className="hint">Your PIN is only sent to CoinSwitch to log in. It is never saved.</p>
            </div>
          )}
        </form>
      </Modal>

      {/* Lead list */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#eceef2]">Saved lead list</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[#7d8390]">
            Your affiliate leads (500 per page), used by bulk block / unblock for last activity, deposit and trade status. Bulk tools refresh it
            automatically before checking; it stays on the server and the website never sees it.
          </p>
          <p className="mt-1 text-[12px] text-[#b4b9c4]">
            {status.leadsCached.toLocaleString()} lead{status.leadsCached === 1 ? "" : "s"} saved now
            <span className="text-[#7d8390]">{status.lastSyncAt ? ` · last full sync ${timeAgo(status.lastSyncAt)}` : " · never fully synced"}</span>
          </p>
        </div>
        {sync ? (
          <div className="flex shrink-0 items-center gap-2 text-[12px] text-[#b4b9c4]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {sync.totalPages ? `Page ${sync.page} of ${sync.totalPages} · ${sync.leads.toLocaleString()} of ${sync.total.toLocaleString()}` : "Starting…"}
            <button className="btn btn-ghost btn-sm" onClick={() => (stopSync.current = true)}>
              Stop
            </button>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm shrink-0" onClick={runSync} disabled={!status.connected || status.expired}>
            <RefreshCw className="h-3 w-3" /> Sync leads now
          </button>
        )}
      </div>

      {status.leadsCached > 0 && (
        <details className="text-[12px] text-[#7d8390]">
          <summary className="cursor-pointer hover:text-[#b4b9c4]">Status values CoinSwitch sends (used by bulk block / unblock rules)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            {statusFields.map(({ f, values }) => (
              <div key={f} className="rounded-[5px] border border-[#262a33] px-2.5 py-2">
                <div className="mb-1 font-medium capitalize text-[#b4b9c4]">{f}</div>
                {values.map((v) => (
                  <div key={v.value} className="flex justify-between gap-2">
                    <span className="truncate">{v.value}</span>
                    <span className="tabular-nums">{v.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
