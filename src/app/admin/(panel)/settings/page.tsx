"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAdmin, ViewOnlyBadge } from "@/components/admin-context";
import { useConfirm } from "@/components/confirm";
import { Dot, Loading, PageHeader, Toggle } from "@/components/admin-ui";
import { SETTINGS_GROUP_PERMISSION } from "@/lib/permissions";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";

interface Setting {
  key: string;
  label: string;
  type: "text" | "secret" | "number" | "boolean" | "textarea" | "url" | "email";
  group: string;
  help?: string;
  placeholder?: string;
  value: string;
  isSet: boolean;
  masked?: string;
}

const GROUPS = [
  { id: "elefin", title: "Elefin API", desc: "Used to look up clients. The token is sent as a Bearer token on every request." },
  { id: "eligibility", title: "Eligibility", desc: "Rules a client must meet to receive the videos." },
  { id: "telegram", title: "Telegram bot", desc: "Logs members in and delivers the videos with copyMessage." },
  { id: "email", title: "Email verification", desc: "Optionally send a one-time code with Resend to confirm members own their email." },
  { id: "general", title: "Site", desc: "Text and links shown on the public page." },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const toast = useToast();
  const { can } = useAdmin();
  const confirm = useConfirm();

  function load(list: Setting[]) {
    setSettings(list);
    setDraft(Object.fromEntries(list.map((s) => [s.key, s.value ?? ""])));
  }

  useEffect(() => {
    api<{ settings: Setting[] }>("/api/admin/settings").then((r) => load(r.settings)).catch((e) => toast(e.message, "error"));
  }, [toast]);

  useEffect(() => {
    if (settings && window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView({ behavior: "smooth" });
  }, [settings]);

  const dirty = (group: string) =>
    settings?.some((s) => s.group === group && s.key !== "telegram_bot_username" && (draft[s.key] ?? "") !== (s.value ?? "")) ?? false;

  async function save(group: string) {
    if (!settings) return;
    setSaving(group);
    const body: Record<string, string> = {};
    for (const s of settings.filter((x) => x.group === group)) {
      if (s.key === "telegram_bot_username") continue;
      body[s.key] = draft[s.key] ?? "";
    }
    try {
      const r = await api<{ settings: Setting[]; note?: string }>("/api/admin/settings", { method: "PUT", body });
      load(r.settings);
      toast(r.note ? `Saved. ${r.note}` : "Settings saved.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  async function clearSecret(key: string) {
    const label = settings?.find((s) => s.key === key)?.label ?? "this secret";
    const ok = await confirm({
      title: "Remove saved secret?",
      message: <>The saved {label} will be deleted. Features that need it will stop working until you add a new one.</>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api<{ settings: Setting[] }>("/api/admin/settings", { method: "PUT", body: { [key]: "__clear__" } });
      load(r.settings);
      toast("Secret removed.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!settings) return <Loading />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Integrations, credentials and rules. Changes apply immediately after saving." />

      <div className="flex gap-6">
        <nav className="sticky top-6 hidden h-fit w-[160px] shrink-0 space-y-px xl:block">
          {GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="block rounded-[5px] px-2.5 py-1.5 text-[#a9afbb] hover:bg-[#1a1e26] hover:text-white">
              {g.title}
            </a>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
          {GROUPS.map((g) => {
            const items = settings.filter((s) => s.group === g.id);
            const editable = can(SETTINGS_GROUP_PERMISSION[g.id]);
            return (
              <section key={g.id} id={g.id} className="card scroll-mt-6 overflow-hidden">
                <div className="border-b border-[#262a33] px-4 py-3">
                  <h2 className="card-title flex items-center gap-2">
                    {g.title} {!editable && <ViewOnlyBadge />}
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[#8b919d]">{g.desc}</p>
                </div>

                {g.id === "telegram" && <TelegramLoginUrls />}
                {g.id === "telegram" && <TelegramWebhookPanel editable={editable} />}

                <fieldset disabled={!editable} className="divide-y divide-[#20242c] disabled:[&_input]:opacity-70">
                  {items.map((s) => (
                    <Field
                      key={s.key}
                      s={s}
                      value={draft[s.key] ?? ""}
                      onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
                      onClear={() => clearSecret(s.key)}
                      readOnly={!editable}
                    />
                  ))}
                </fieldset>

                {editable && (
                <div className="flex flex-col-reverse gap-3 border-t border-[#262a33] bg-[#13161b] px-4 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <TestPanel group={g.id} />
                  <button className="btn btn-primary self-end sm:self-auto" onClick={() => save(g.id)} disabled={saving === g.id || !dirty(g.id)}>
                    {saving === g.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                  </button>
                </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Field({ s, value, onChange, onClear, readOnly }: { s: Setting; value: string; onChange: (v: string) => void; onClear: () => void; readOnly?: boolean }) {
  const [show, setShow] = useState(false);
  const id = `f-${s.key}`;

  let control: React.ReactNode;
  if (s.type === "boolean") {
    control = <Toggle checked={value === "1"} onChange={(v) => onChange(v ? "1" : "0")} disabled={readOnly} />;
  } else if (s.type === "textarea") {
    control = <textarea id={id} className="input min-h-[72px] resize-y" value={value} placeholder={s.placeholder} onChange={(e) => onChange(e.target.value)} />;
  } else if (s.type === "secret") {
    control = (
      <div className="relative">
        <input
          id={id}
          className="input pr-16 font-mono text-[12px]"
          type={show ? "text" : "password"}
          autoComplete="off"
          value={value}
          placeholder={s.isSet ? `${s.masked} (saved)` : "Not set"}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          <button type="button" onClick={() => setShow(!show)} className="btn btn-ghost btn-sm btn-icon h-6 w-6" aria-label={show ? "Hide" : "Show"}>
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          {s.isSet && !readOnly && (
            <button type="button" onClick={onClear} className="rounded px-1.5 py-0.5 text-[11px] text-[#f19aa5] hover:bg-[#2a1518]">
              Clear
            </button>
          )}
        </div>
      </div>
    );
  } else {
    control = (
      <input
        id={id}
        className={`input ${s.type === "number" ? "max-w-[140px]" : ""}`}
        type={s.type === "number" ? "number" : s.type === "email" ? "email" : "text"}
        step={s.type === "number" ? "any" : undefined}
        min={s.type === "number" ? 0 : undefined}
        value={value}
        placeholder={s.placeholder}
        readOnly={s.key === "telegram_bot_username"}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className={`grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-6 ${s.type === "boolean" ? "items-center" : "items-start"}`}>
      <div>
        <label htmlFor={id} className="text-[13px] font-medium text-[#eceef2]">
          {s.label}
        </label>
        {s.help && <p className="mt-0.5 text-[12px] leading-relaxed text-[#7d8390]">{s.help}</p>}
      </div>
      <div className={s.type === "boolean" ? "flex md:justify-end" : ""}>{control}</div>
    </div>
  );
}

interface WebhookStatus {
  configured: boolean;
  url?: string | null;
  expected: string;
  connected?: boolean;
  pending?: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
}

/** Shows whether the bot webhook points at this site, and connects or disconnects it. */
function TelegramWebhookPanel({ editable }: { editable: boolean }) {
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => {
    api<WebhookStatus>("/api/admin/telegram/webhook")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  async function connect() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/admin/telegram/webhook", { body: {} });
      toast(r.message, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect webhook?",
      message: "The bot will stop replying to /start and /videos, and members who haven't started the bot won't get videos automatically.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/admin/telegram/webhook", { method: "DELETE" });
      toast(r.message, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const elsewhere = !!status.url && status.url !== status.expected;
  const tone = status.connected ? "ok" : elsewhere ? "warn" : "muted";
  const label = !status.configured
    ? "Save the bot token first"
    : status.connected
      ? "Connected"
      : elsewhere
        ? "Connected to a different address"
        : "Not connected";

  return (
    <div className="border-b border-[#262a33] px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#eceef2]">
            Bot webhook
            <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-[#b4b9c4]">
              <Dot tone={tone} /> {label}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[#7d8390]">
            Lets the bot answer /start and /videos, and send videos to members who open the bot from the website.
            {elsewhere && <> Currently pointing to <code className="text-[#b4b9c4]">{status.url}</code>.</>}
          </p>
          {status.lastError && (
            <p className="mt-1 text-[12px] text-[#f19aa5]">
              Last error{status.lastErrorAt ? ` (${new Date(status.lastErrorAt).toLocaleString()})` : ""}: {status.lastError}
            </p>
          )}
        </div>
        {editable && status.configured && (
          <div className="flex shrink-0 gap-2">
            {status.url && (
              <button className="btn btn-secondary btn-sm" onClick={disconnect} disabled={busy}>
                Disconnect
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={connect} disabled={busy}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} {status.connected ? "Reconnect" : "Connect webhook"}
            </button>
          </div>
        )}
      </div>
      {editable && status.configured && !status.connected && (
        <p className="mt-1.5 text-[11px] text-[#646b78]">Will connect to {status.expected}. Telegram needs a public HTTPS address (your domain or ngrok).</p>
      )}
    </div>
  );
}

/** The URLs that must be registered in BotFather → Login Widget for Telegram Login to work on this domain. */
function TelegramLoginUrls() {
  const [origin, setOrigin] = useState("");
  const toast = useToast();
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;
  const rows = [
    { label: "Allowed URL", value: origin },
    { label: "Redirect URI", value: `${origin}/api/telegram/callback` },
  ];
  return (
    <div className="border-b border-[#262a33] bg-[#121a2c] px-4 py-3">
      <p className="text-[12px] leading-relaxed text-[#a9c1ff]">
        In @BotFather, open your bot → <span className="text-white">Login Widget</span>, copy the client ID and secret below, and register these URLs. Telegram only
        redirects to registered URLs.
      </p>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-[92px] shrink-0 text-[12px] text-[#8b919d]">{r.label}</span>
            <code className="min-w-0 flex-1 truncate rounded-[4px] border border-[#2b3a5c] bg-[#0f1115] px-2 py-1 font-mono text-[12px] text-[#d4d7de]">{r.value}</code>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard.writeText(r.value).then(() => toast("Copied.", "success"), () => toast("Couldn't copy.", "error"))}
            >
              Copy
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TestPanel({ group }: { group: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; data?: unknown } | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const type = group === "elefin" ? "elefin" : group === "telegram" ? "telegram" : group === "email" ? "email" : null;
  if (!type) return <div />;
  const needsEmail = type !== "telegram";

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const r = await api<{ message: string; data?: unknown }>("/api/admin/test", { body: { type, email } });
      setResult({ ok: true, message: r.message, data: r.data });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        {needsEmail && (
          <input
            className="input w-[220px]"
            placeholder={type === "elefin" ? "Client email to look up" : "Send test email to"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <button className="btn btn-secondary" onClick={run} disabled={loading || (needsEmail && !email)}>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {type === "elefin" ? "Test lookup" : type === "telegram" ? "Test bot" : "Send test"}
        </button>
        <span className="text-[12px] text-[#646b78]">Uses saved values</span>
      </div>
      {result && (
        <div
          className={`mt-2 rounded-[5px] border px-3 py-2 text-[12px] leading-relaxed ${
            result.ok ? "border-[#1d4430] bg-[#0f2418] text-[#8fe3b0]" : "border-[#4a2429] bg-[#2a1518] text-[#f5b8c0]"
          }`}
        >
          {result.message}
          {result.data !== undefined && (
            <>
              <button className="ml-2 underline opacity-70 hover:opacity-100" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? "Hide response" : "Show response"}
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[#0b0d10] p-2.5 font-mono text-[11px] text-[#b4b9c4]">{JSON.stringify(result.data, null, 2)}</pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
