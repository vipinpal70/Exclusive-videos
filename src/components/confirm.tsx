"use client";

import { AlertTriangle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn>(async () => false);

/** Provides `useConfirm()`: an async replacement for window.confirm that renders a styled dialog. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    []
  );

  const close = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  useEffect(() => {
    if (!opts) return;
    // Capture phase so Escape closes only this dialog, not a dialog underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [opts, close]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {opts && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-3 pt-[14vh]" onMouseDown={() => close(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="animate-fade-up w-full max-w-[420px] rounded-md border border-[#2c313b] bg-[#15181e] shadow-2xl shadow-black/50"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex gap-3 px-4 pb-3 pt-4">
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${opts.danger ? "bg-[#3a1a1e] text-[#f19aa5]" : "bg-[#1b2a52] text-brand-300"}`}
              >
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 id="confirm-title" className="text-[14px] font-semibold text-[#f2f3f6]">
                  {opts.title}
                </h3>
                <div className="mt-1 text-[13px] leading-relaxed text-[#a9afbb]">{opts.message}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#262a33] bg-[#13161b] px-4 py-3">
              {/* Destructive actions focus Cancel, so pressing Enter by habit can't delete anything. */}
              <button autoFocus={!!opts.danger} className="btn btn-secondary" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                autoFocus={!opts.danger}
                className={`btn ${opts.danger ? "border border-[#7a2a33] bg-[#b4232f] text-white hover:bg-[#c92a37]" : "btn-primary"}`}
                onClick={() => close(true)}
              >
                {opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
