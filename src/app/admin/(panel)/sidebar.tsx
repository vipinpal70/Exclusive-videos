"use client";

import { ExternalLink, LayoutDashboard, ListChecks, Loader2, LogOut, Menu, Settings, ShieldUser, Users, Video, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/components/admin-ui";
import { PoweredBy } from "@/components/powered-by";
import { clearAdminTab } from "@/lib/admin-tab";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/videos", label: "Videos", icon: Video },
  { href: "/admin/members", label: "Members", icon: Users },
  { href: "/admin/logs", label: "Activity logs", icon: ListChecks },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/account", label: "Admins", icon: ShieldUser },
];

export function Sidebar({ username, siteName, isSuper }: { username: string; siteName: string; isSuper: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => setOpen(false), [path]);

  async function logout() {
    setSigningOut(true);
    await fetch("/api/admin/logout", { method: "POST" });
    clearAdminTab();
    router.replace("/admin/login");
    router.refresh();
  }

  const nav = (
    <div className="flex h-full flex-col text-[13px]">
      <div className="flex h-12 items-center gap-2 border-b border-[#232730] px-4">
        <img src="/tradecircle-logo.jpeg" alt={siteName} className="h-7 w-7 shrink-0 rounded-[5px] object-cover" />
        <span className="truncate font-medium text-[#eceef2]">{siteName}</span>
      </div>
      <nav className="flex-1 space-y-px px-2 py-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex h-8 items-center gap-2.5 rounded-[5px] px-2.5 transition-colors ${
                active ? "bg-[#1f2430] font-medium text-white shadow-[inset_2px_0_0_var(--color-brand-500)]" : "text-[#a9afbb] hover:bg-[#1a1e26] hover:text-white"
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? "text-brand-400" : "text-[#7d8390]"}`} /> {label}
            </Link>
          );
        })}
        <div className="my-2 h-px bg-[#232730]" />
        <a href="/" target="_blank" className="flex h-8 items-center gap-2.5 rounded-[5px] px-2.5 text-[#a9afbb] transition-colors hover:bg-[#1a1e26] hover:text-white">
          <ExternalLink className="h-4 w-4 text-[#7d8390]" /> View site
        </a>
      </nav>
      <PoweredBy className="px-4 pb-2.5 text-[11px] text-[#5a606c] [&_a]:text-[#8b919d] [&_a:hover]:text-white" />
      <div className="flex h-12 items-center gap-2 border-t border-[#232730] px-3">
        <div className="grid h-6 w-6 place-items-center rounded-full bg-[#262b35] text-[11px] font-medium uppercase text-[#d4d7de]">{username[0]}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[#b4b9c4]">{username}</div>
          <div className="text-[11px] leading-tight text-[#646b78]">{isSuper ? "Super admin" : "Admin"}</div>
        </div>
        <button onClick={() => setConfirmOut(true)} title="Sign out" aria-label="Sign out" className="btn btn-ghost btn-sm btn-icon">
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-[#232730] bg-[#121419] px-4 lg:hidden">
        <span className="text-[13px] font-medium text-white">{siteName}</span>
        <button onClick={() => setOpen(true)} className="btn btn-ghost btn-sm btn-icon" aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="relative h-full w-[240px] border-r border-[#232730] bg-[#121419]" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm btn-icon absolute right-2 top-2.5" aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            {nav}
          </aside>
        </div>
      )}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] border-r border-[#232730] bg-[#121419] lg:block">{nav}</aside>

      <Modal
        open={confirmOut}
        onClose={() => !signingOut && setConfirmOut(false)}
        title="Sign out?"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOut(false)} disabled={signingOut}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={logout} disabled={signingOut} autoFocus>
              {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out
            </button>
          </>
        }
      >
        <p className="text-[13px] text-[#b4b9c4]">
          You&apos;ll be signed out of the admin panel as <span className="text-[#eceef2]">{username}</span>. Unsaved changes on this page will be lost.
        </p>
      </Modal>
    </>
  );
}
