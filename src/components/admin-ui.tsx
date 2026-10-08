"use client";

import { ChevronLeft, ChevronRight, Loader2, MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-[20px] font-semibold leading-tight text-[#f2f3f6]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-[#8b919d]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, size = "md" }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex shrink-0 items-center rounded-full transition disabled:opacity-50 ${sm ? "h-[18px] w-8" : "h-5 w-9"} ${
        checked ? "bg-brand-600" : "bg-[#3a3f4b]"
      }`}
    >
      <span
        className={`inline-block rounded-full bg-white shadow transition ${sm ? "h-3.5 w-3.5" : "h-4 w-4"} ${
          checked ? (sm ? "translate-x-[16px]" : "translate-x-[18px]") : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 pt-[8vh]" onMouseDown={onClose}>
      <div
        className={`animate-fade-up w-full rounded-md border border-[#2c313b] bg-[#15181e] shadow-2xl shadow-black/50 ${wide ? "max-w-3xl" : "max-w-lg"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#262a33] px-4 py-3">
          <h3 className="text-[14px] font-semibold text-[#f2f3f6]">{title}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-icon" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[#262a33] bg-[#13161b] px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

/** "⋯" button that opens a dropdown of row actions. */
export function ActionMenu({ actions, label = "Actions" }: { actions: MenuAction[]; label?: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = pos !== null;
  const setOpen = (o: boolean | ((o: boolean) => boolean)) => {
    const next = typeof o === "function" ? o(open) : o;
    if (!next) return setPos(null);
    // Fixed positioning so the menu is never clipped by scrolling table containers.
    const r = btn.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    const estHeight = actions.length * 30 + actions.filter((a) => a.separator).length * 9 + 8;
    setPos(r.bottom + estHeight + 8 > window.innerHeight ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setPos(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const dismiss = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`btn btn-ghost btn-sm btn-icon ${open ? "bg-[#1f232b] text-white" : ""}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="menu" style={{ position: "fixed", ...pos }} role="menu">
          {actions.map((a, i) => (
            <div key={i}>
              {a.separator && <div className="menu-sep" />}
              <button
                role="menuitem"
                disabled={a.disabled}
                className={`menu-item ${a.danger ? "text-[#f19aa5] hover:bg-[#2a1518]" : ""}`}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                {a.icon && <span className="flex h-4 w-4 items-center justify-center opacity-80 [&>svg]:h-3.5 [&>svg]:w-3.5">{a.icon}</span>}
                {a.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between text-[12px] text-[#8b919d]">
        <span>{label}</span>
        {icon && <span className="text-[#646b78] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-tight text-[#f2f3f6]">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-[#7d8390]">{hint}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 text-[#646b78] [&>svg]:h-6 [&>svg]:w-6">{icon}</div>
      <h3 className="text-[14px] font-medium text-[#eceef2]">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-[13px] text-[#8b919d]">{children}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-[#646b78]">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-[#262a33] px-3 py-2 text-[12px] text-[#8b919d]">
      <span>
        {total} result{total === 1 ? "" : "s"}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </span>
      {pages > 1 && (
        <div className="flex gap-1">
          <button className="btn btn-secondary btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button className="btn btn-secondary btn-sm btn-icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const cls = ok === null ? "bg-[#262a33] text-[#b4b9c4]" : ok ? "bg-[#12301f] text-[#6fd99a]" : "bg-[#3a1a1e] text-[#f19aa5]";
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Dot({ tone }: { tone: "ok" | "error" | "muted" | "warn" }) {
  const c = { ok: "bg-[#3ecf7a]", error: "bg-[#f0566a]", muted: "bg-[#646b78]", warn: "bg-[#f5a524]" }[tone];
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#646b78]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input className="input pl-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`h-7 rounded-[5px] px-2.5 text-[12px] font-medium transition ${
            value === t.id ? "bg-[#232833] text-white" : "text-[#8b919d] hover:bg-[#1c2028] hover:text-[#d4d7de]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
