"use client";

import { Loader2, PlayCircle } from "lucide-react";
import { PoweredBy } from "./powered-by";

export function AuthShell(props: {
  title: string;
  subtitle: string;
  onSubmit: (e: React.FormEvent) => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  loading: boolean;
  error: string;
  button: string;
  passwordHint?: string;
  notice?: string;
  remember?: boolean;
  setRemember?: (v: boolean) => void;
}) {
  return (
    <div className="admin grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-5 flex items-center justify-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-[5px] bg-brand-600 text-white">
            <PlayCircle className="h-4 w-4" />
          </div>
          <span className="text-[14px] font-medium text-[#eceef2]">Admin panel</span>
        </div>
        <form onSubmit={props.onSubmit} className="card animate-fade-up overflow-hidden">
          <div className="border-b border-[#262a33] px-5 py-4">
            <h1 className="text-[16px] font-semibold text-[#f2f3f6]">{props.title}</h1>
            <p className="mt-0.5 text-[12px] text-[#8b919d]">{props.subtitle}</p>
          </div>
          <div className="space-y-3 px-5 py-4">
            {props.notice && (
              <p className="rounded-[5px] border border-[#2b3a5c] bg-[#121a2c] px-3 py-2 text-[12px] leading-relaxed text-[#a9c1ff]">{props.notice}</p>
            )}
            <div>
              <label className="label" htmlFor="auth-user">
                Username
              </label>
              <input
                id="auth-user"
                className="input"
                autoFocus
                autoComplete="username"
                value={props.username}
                onChange={(e) => props.setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="auth-pw">
                Password
              </label>
              <input
                id="auth-pw"
                className="input"
                type="password"
                autoComplete={props.passwordHint ? "new-password" : "current-password"}
                value={props.password}
                onChange={(e) => props.setPassword(e.target.value)}
                required
              />
              {props.passwordHint && <p className="hint">{props.passwordHint}</p>}
            </div>
            {props.setRemember && (
              <label htmlFor="auth-remember" className="flex select-none items-start gap-2 text-[13px] text-[#d4d7de]">
                <input
                  id="auth-remember"
                  type="checkbox"
                  className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[#0a47ec]"
                  checked={!!props.remember}
                  onChange={(e) => props.setRemember!(e.target.checked)}
                />
                <span>
                  Remember me
                  <span className="block text-[12px] text-[#7d8390]">
                    {props.remember ? "Stay signed in on this browser for 30 days." : "Off: you stay signed in only in this tab."}
                  </span>
                </span>
              </label>
            )}
            {props.error && (
              <p className="rounded-[5px] border border-[#4a2429] bg-[#2a1518] px-3 py-2 text-[12px] text-[#f5b8c0]">{props.error}</p>
            )}
            <button className="btn btn-primary w-full" disabled={props.loading}>
              {props.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {props.button}
            </button>
          </div>
        </form>
        <PoweredBy className="mt-4 text-center text-[#646b78] [&_a]:text-[#a9afbb] [&_a:hover]:text-white" />
      </div>
    </div>
  );
}
