"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Circle, CircleHelp, Send, UserCheck, Users, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loading, Modal, PageHeader, StatCard } from "@/components/admin-ui";
import { api, timeAgo } from "@/lib/api";

interface Stats {
  members: { total: number; eligible: number; linked: number; delivered: number; blocked: number };
  videos: { total: number; active: number; errors: number };
  deliveries: { sent: number; failed: number; sent24h: number };
  lookups7d: { total: number; eligible: number; notFound: number };
  daily: { day: string; lookups: number; eligible: number }[];
  recent: { id: number; email: string; name: string | null; lots: number; telegram_username: string | null; last_delivered_at: string }[];
  setup: { elefin: boolean; telegram: boolean; email: boolean; otpEnabled: boolean; videos: boolean };
  coinswitch: { connected: boolean; expired: boolean; expiresAt: string | null } | null;
}

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [funnelHelp, setFunnelHelp] = useState(false);
  useEffect(() => {
    api<Stats>("/api/admin/stats").then(setS).catch(() => {});
  }, []);
  if (!s) return <Loading />;

  const checklist = [
    { ok: s.setup.elefin, label: "Connect the Elefin API", href: "/admin/settings#elefin" },
    { ok: s.setup.telegram, label: "Configure the Telegram bot", href: "/admin/settings#telegram" },
    { ok: s.setup.email, label: s.setup.otpEnabled ? "Configure email OTP" : "Email OTP (optional)", href: "/admin/settings#email" },
    { ok: s.setup.videos, label: "Add at least one active video", href: "/admin/videos" },
  ];
  const done = checklist.filter((c) => c.ok).length;

  const days: { day: string; lookups: number; eligible: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push(s.daily.find((x) => x.day === d) ?? { day: d, lookups: 0, eligible: 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.lookups));
  const funnel = [
    {
      label: "Members found",
      v: s.members.total,
      help: "People who entered an email on the site that matched a client in Elefin. Emails with no Elefin account are not counted (see Activity logs → Eligibility checks).",
    },
    {
      label: "Eligible",
      v: s.members.eligible,
      help: "Members who met your eligibility rules at their last check: minimum lots, plus affiliated, active status and minimum net deposit if those rules are on.",
    },
    {
      label: "Telegram linked",
      v: s.members.linked,
      help: "Eligible members who confirmed their email (when OTP is on) and connected a Telegram account with “Allow messages”, so the bot can send to them.",
    },
    {
      label: "Received videos",
      v: s.members.delivered,
      help: "Members who clicked “Get my videos” and had at least one video delivered to their Telegram. Each member is counted once, however many times they request.",
    },
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle="Verifications and video deliveries at a glance." />

      {s.coinswitch &&
        (s.coinswitch.expired || (s.coinswitch.expiresAt && new Date(s.coinswitch.expiresAt).getTime() - Date.now() < 4 * 3600_000)) && (
          <Link
            href="/admin/settings#coinswitch"
            className="mb-4 flex items-center gap-2 rounded-md border border-[#5c4a1f] bg-[#2a2211] px-4 py-2.5 text-[13px] text-[#f5d58a] hover:bg-[#33290f]"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {s.coinswitch.expired
              ? "The CoinSwitch access token has expired. New CoinSwitch clients can’t verify until you get a new one."
              : `The CoinSwitch access token expires ${new Date(s.coinswitch.expiresAt!).toLocaleString()}. Refresh it soon.`}
            <ArrowRight className="ml-auto h-3.5 w-3.5" />
          </Link>
        )}

      {done < checklist.length && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">Finish setup</span>
            <span className="text-[12px] text-[#8b919d]">
              {done} of {checklist.length} complete
            </span>
          </div>
          <div className="grid sm:grid-cols-2">
            {checklist.map((c, i) => (
              <Link
                key={c.label}
                href={c.href}
                className={`group flex h-10 items-center gap-2.5 px-4 transition-colors hover:bg-[#1a1d24] ${i % 2 === 0 ? "sm:border-r sm:border-[#20242c]" : ""} ${i < 2 ? "border-b border-[#20242c]" : ""}`}
              >
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-[#3ecf7a]" /> : <Circle className="h-4 w-4 text-[#4d5360]" />}
                <span className={c.ok ? "text-[#7d8390] line-through decoration-[#4d5360]" : "text-[#d4d7de]"}>{c.label}</span>
                {!c.ok && <ArrowRight className="ml-auto h-3.5 w-3.5 text-[#646b78] group-hover:text-brand-300" />}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Members" value={s.members.total} icon={<Users />} hint={`${s.members.eligible} eligible · ${s.members.blocked} blocked`} />
        <StatCard label="Telegram linked" value={s.members.linked} icon={<UserCheck />} hint={`${s.members.delivered} received videos`} />
        <StatCard label="Videos sent" value={s.deliveries.sent} icon={<Send />} hint={`${s.deliveries.sent24h} in 24h · ${s.deliveries.failed} failed`} />
        <StatCard
          label="Active videos"
          value={s.videos.active}
          icon={<Video />}
          hint={s.videos.errors ? `${s.videos.errors} need attention` : `${s.videos.total} total`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Eligibility checks</span>
            <div className="flex items-center gap-3 text-[12px] text-[#8b919d]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#3a3f4b]" />
                All
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-brand-500" />
                Eligible
              </span>
            </div>
          </div>
          <div className="px-4 pb-3 pt-3">
            <p className="mb-3 text-[12px] text-[#7d8390]">
              Last 7 days: {s.lookups7d.total} checks, {s.lookups7d.eligible} eligible, {s.lookups7d.notFound} not found
            </p>
            <div className="flex h-36 items-end gap-1">
              {days.map((d) => (
                <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className="relative w-full rounded-t-[2px] bg-[#2c313b]" style={{ height: `${(d.lookups / max) * 100}%`, minHeight: d.lookups ? 3 : 1 }}>
                    <div className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-brand-500" style={{ height: d.lookups ? `${(d.eligible / d.lookups) * 100}%` : 0 }} />
                  </div>
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded border border-[#2c313b] bg-[#1a1d24] px-2 py-1 text-[11px] text-[#d4d7de] shadow-lg group-hover:block">
                    {d.day.slice(5)}: {d.lookups} checks, {d.eligible} eligible
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-[#646b78]">
              <span>{days[0].day.slice(5)}</span>
              <span>Today</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Funnel</span>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setFunnelHelp(true)} aria-label="What do these numbers mean?" title="What do these numbers mean?">
              <CircleHelp className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3 px-4 py-3">
            {funnel.map((f) => (
              <div key={f.label}>
                <div className="mb-1 flex justify-between">
                  <span className="text-[#a9afbb]">{f.label}</span>
                  <span className="tabular-nums text-[#eceef2]">{f.v}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#232833]">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${s.members.total ? (f.v / s.members.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-3 overflow-hidden">
        <div className="card-header">
          <span className="card-title">Recent deliveries</span>
          <Link href="/admin/members?filter=delivered" className="text-[12px] text-brand-300 hover:text-brand-200">
            View all
          </Link>
        </div>
        {s.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-[#7d8390]">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th className="text-right">Lots</th>
                  <th>Telegram</th>
                  <th className="text-right">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {s.recent.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="text-[#eceef2]">{r.name || r.email}</span>
                      {r.name && <span className="ml-2 text-[12px] text-[#7d8390]">{r.email}</span>}
                    </td>
                    <td className="text-right tabular-nums text-[#b4b9c4]">{Number(r.lots).toFixed(2)}</td>
                    <td className="text-[#b4b9c4]">{r.telegram_username ? `@${r.telegram_username}` : "—"}</td>
                    <td className="text-right text-[#8b919d]">{timeAgo(r.last_delivered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={funnelHelp}
        onClose={() => setFunnelHelp(false)}
        title="About the funnel"
        footer={
          <button className="btn btn-secondary" onClick={() => setFunnelHelp(false)}>
            Close
          </button>
        }
      >
        <p className="mb-3 text-[13px] text-[#8b919d]">
          Each stage counts members who reached that step. The bars compare each stage with all members found, so you can see where people drop off.
        </p>
        <dl className="divide-y divide-[#20242c] overflow-hidden rounded-[5px] border border-[#262a33]">
          {funnel.map((f) => (
            <div key={f.label} className="px-3 py-2.5">
              <dt className="flex items-center justify-between text-[13px] font-medium text-[#eceef2]">
                {f.label}
                <span className="tabular-nums text-[#8b919d]">{f.v}</span>
              </dt>
              <dd className="mt-0.5 text-[12px] leading-relaxed text-[#8b919d]">{f.help}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}
