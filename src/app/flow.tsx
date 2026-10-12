"use client";

import { CheckCircle2, ChevronLeft, Hash, Loader2, Mail, Phone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";

interface PublicSettings {
  siteName: string;
  heroTitle: string;
  heroSubtitle: string;
  signupUrl: string;
  supportUrl: string;
  otpEnabled: boolean;
  botUsername: string;
  telegramLoginReady: boolean;
  minLots: number;
  xmEnabled: boolean;
  xmMinLots: number;
  xmSignupUrl: string;
  csEnabled: boolean;
  csSignupUrl: string;
  xmLotsWindowDays: number;
  videoCount: number;
}

interface Member {
  email: string;
  name: string | null;
  lots: number;
  eligible: boolean;
  emailVerified: boolean;
  telegram: { id: string; username: string | null; name: string | null; photoUrl: string | null } | null;
  lastDeliveredAt: string | null;
}

interface Rejection {
  message: string;
  code?: string;
  lots?: number;
  minLots?: number;
  signupUrl?: string | null;
  broker?: "elefin" | "xm" | "coinswitch";
}

type Step = "email" | "otp" | "telegram" | "deliver";

function stepOf(m: Member | null): Step {
  if (!m) return "email";
  if (!m.emailVerified) return "otp";
  if (!m.telegram) return "telegram";
  return "deliver";
}

export function Flow({ settings, initialMember }: { settings: PublicSettings; initialMember: Member | null }) {
  const [member, setMember] = useState<Member | null>(initialMember);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [tgError, setTgError] = useState("");
  const toast = useToast();
  const step = stepOf(member);

  // Telegram Login redirects back here with ?tg=linked or ?tg_error=...; show the result and tidy the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("tg") && !q.has("tg_error")) return;
    if (q.get("tg_error")) setTgError(q.get("tg_error")!);
    else if (q.get("tg_msg") === "0") toast(`Open @${settings.botUsername} in Telegram and press Start so we can send you the videos.`, "info");
    else if (q.get("tg") === "linked") toast("Telegram connected.", "success");
    window.history.replaceState(null, "", window.location.pathname);
  }, [toast, settings.botUsername]);

  const steps: Step[] = settings.otpEnabled ? ["email", "otp", "telegram", "deliver"] : ["email", "telegram", "deliver"];
  const idx = steps.indexOf(step);

  async function reset() {
    await fetch("/api/logout", { method: "POST" });
    setMember(null);
    setRejection(null);
  }

  return (
    <div className="ef-page flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-7 sm:px-[60px]">
        <div className="flex items-center gap-2.5">
          <img src="/tradecircle-logo.jpeg" alt={settings.siteName} className="h-7 w-7 rounded-[6px] object-cover" />
          <span className="text-[18px] font-medium leading-none tracking-[-0.02em] text-white">{settings.siteName}</span>
        </div>
        {settings.supportUrl && (
          <a href={settings.supportUrl} target="_blank" rel="noreferrer" className="ef-nav">
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} /> Support
          </a>
        )}
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-10 sm:pt-[100px]">
        <div className="w-full max-w-[456px]">
          {!rejection && (
            <div className="mb-6 flex items-center gap-1.5">
              {steps.map((s, i) => (
                <span key={s} className={`h-[3px] flex-1 rounded-full transition-colors ${i <= idx ? "bg-[#0a47ec]" : "bg-[#262c3b]"}`} />
              ))}
            </div>
          )}

          <div key={rejection ? "rej" : step} className="animate-fade-up">
            {rejection ? (
              <RejectionView r={rejection} onBack={() => setRejection(null)} />
            ) : step === "email" ? (
              <EmailStep settings={settings} onDone={setMember} onReject={setRejection} />
            ) : step === "otp" ? (
              <OtpStep email={member!.email} onDone={setMember} onBack={reset} />
            ) : step === "telegram" ? (
              <TelegramStep ready={settings.telegramLoginReady} member={member!} error={tgError} onBack={reset} />
            ) : (
              <DeliverStep
                botUsername={settings.botUsername}
                member={member!}
                onDelivered={(at) => setMember({ ...member!, lastDeliveredAt: at })}
                onBack={reset}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-9">
      <h1 className="ef-title">{title}</h1>
      {children && <p className="ef-sub">{children}</p>}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 rounded-xl border border-[#5c2a33] bg-[#2a1419] px-4 py-3 text-[14px] leading-relaxed text-[#f3b7c0]">{children}</p>;
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-7 space-y-2.5 border-t border-[#262c3b] pt-6 text-[14px] leading-[1.55] text-[#a3a9b6]">{children}</div>;
}

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="ef-link">
      {children}
    </button>
  );
}

/* ---------------- Step 1: account ---------------- */
type BrokerChoice = "elefin" | "xm" | "coinswitch";
const BROKER_NAME: Record<BrokerChoice, string> = { elefin: "Elefin", xm: "XM", coinswitch: "CoinSwitch" };

function EmailStep({ settings, onDone, onReject }: { settings: PublicSettings; onDone: (m: Member) => void; onReject: (r: Rejection) => void }) {
  const [broker, setBroker] = useState<BrokerChoice>("elefin");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState("");
  const [csClientId, setCsClientId] = useState("");
  const [csPhone, setCsPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isXm = broker === "xm";
  const isCs = broker === "coinswitch";
  const brokers = (["elefin", "xm", "coinswitch"] as const).filter(
    (b) => b === "elefin" || (b === "xm" && settings.xmEnabled) || (b === "coinswitch" && settings.csEnabled)
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = isXm
        ? await api<{ member: Member }>("/api/verify/xm", { body: { loginId } })
        : isCs
          ? await api<{ member: Member }>("/api/verify/coinswitch", { body: { clientId: csClientId, phone: csPhone } })
          : await api<{ member: Member }>("/api/verify/email", { body: { email } });
      onDone(r.member);
    } catch (err) {
      if (err instanceof ApiError && ["not_found", "not_eligible", "blocked"].includes(String(err.data.code))) {
        onReject({ message: err.message, broker, ...(err.data as Omit<Rejection, "message">) });
      } else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const minLots = isXm ? settings.xmMinLots : settings.minLots;
  const videosText = settings.videoCount > 1 ? ` all ${settings.videoCount} videos` : settings.videoCount === 1 ? " the video" : " the videos";

  return (
    <form onSubmit={submit}>
      <Heading title={settings.heroTitle}>{settings.heroSubtitle}</Heading>

      {brokers.length > 1 && (
        <div className="mb-6">
          <span className="ef-label">Your broker</span>
          <div
            className={`grid gap-1 rounded-full border border-[#2c3343] p-1 ${brokers.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
            role="radiogroup"
            aria-label="Broker"
          >
            {brokers.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={broker === b}
                onClick={() => {
                  setBroker(b);
                  setError("");
                }}
                className={`h-10 rounded-full text-[15px] font-medium transition ${
                  broker === b ? "bg-[#0a47ec] text-white" : "text-[#a3a9b6] hover:text-white"
                }`}
              >
                {BROKER_NAME[b]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isCs ? (
        <>
          <label className="ef-label" htmlFor="cs-client">
            CoinSwitch client ID
          </label>
          <div className="relative">
            <Hash className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6b7282]" />
            <input
              id="cs-client"
              inputMode="numeric"
              required
              autoFocus
              autoComplete="off"
              placeholder="e.g. 13349"
              className="ef-input h-12 pl-11 text-[16px]"
              value={csClientId}
              onChange={(e) => setCsClientId(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <label className="ef-label mt-5" htmlFor="cs-phone">
            Phone number
          </label>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6b7282]" />
            <input
              id="cs-phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="+91 98765 43210"
              className="ef-input h-12 pl-11 text-[16px]"
              value={csPhone}
              onChange={(e) => setCsPhone(e.target.value.replace(/[^\d+\s-]/g, ""))}
            />
          </div>
        </>
      ) : isXm ? (
        <>
          <label className="ef-label" htmlFor="xm-login">
            XM MT5 account ID
          </label>
          <div className="relative">
            <Hash className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6b7282]" />
            <input
              id="xm-login"
              inputMode="numeric"
              required
              autoFocus
              autoComplete="off"
              placeholder="e.g. 430464082"
              pattern="[0-9 ]{5,14}"
              className="ef-input h-12 pl-11 text-[16px]"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value.replace(/[^\d ]/g, ""))}
            />
          </div>
        </>
      ) : (
        <>
          <label className="ef-label" htmlFor="email">
            Email address
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6b7282]" />
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              className="ef-input h-12 pl-11 text-[16px]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}

      <button className="ef-btn mt-11" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? "Checking your account…" : "Continue"}
      </button>

      <Footer>
        <p>
          {isCs
            ? "Enter your CoinSwitch client ID and the phone number registered with CoinSwitch. You need an active CoinSwitch account opened with our referral to unlock"
            : isXm
            ? `Enter the MT5 account ID of your XM account (you'll find it in your XM Members Area). You need at least ${minLots} lot${minLots === 1 ? "" : "s"} traded in the last ${settings.xmLotsWindowDays} days to unlock`
            : `Use the email of your Elefin trading account. You need at least ${minLots} traded lot${minLots === 1 ? "" : "s"} to unlock`}
          {videosText}.
        </p>
        {(isCs ? settings.csSignupUrl : isXm ? settings.xmSignupUrl : settings.signupUrl) && (
          <p>
            Not {isCs ? "a" : "an"} {BROKER_NAME[broker]} client yet?{" "}
            <a href={isCs ? settings.csSignupUrl : isXm ? settings.xmSignupUrl : settings.signupUrl} target="_blank" rel="noreferrer" className="ef-link">
              Open {isCs ? "a" : "an"} {BROKER_NAME[broker]} account
            </a>
            .
          </p>
        )}
      </Footer>
    </form>
  );
}

function RejectionView({ r, onBack }: { r: Rejection; onBack: () => void }) {
  const showProgress = r.code === "not_eligible" && r.minLots !== undefined && r.lots !== undefined && r.lots < r.minLots;
  const pct = showProgress ? Math.min(100, ((r.lots ?? 0) / r.minLots!) * 100) : 0;
  const name = BROKER_NAME[r.broker ?? "elefin"];
  return (
    <div>
      <Heading title={r.code === "not_found" ? "Account not found" : r.code === "blocked" ? "Access disabled" : "Not eligible yet"}>{r.message}</Heading>

      {showProgress && (
        <div className="mb-9">
          <div className="ef-label flex justify-between">
            <span>Traded volume</span>
            <span className="text-white">
              {r.lots} / {r.minLots} lots
            </span>
          </div>
          <div className="h-[6px] overflow-hidden rounded-full bg-[#262c3b]">
            <div className="h-full rounded-full bg-[#0a47ec]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {r.signupUrl && r.code !== "blocked" ? (
        <a href={r.signupUrl} target="_blank" rel="noreferrer" className="ef-btn">
          {r.code === "not_found" ? `Open ${r.broker === "coinswitch" ? "a" : "an"} ${name} account` : `Continue on ${name}`}
        </a>
      ) : null}

      <Footer>
        <p>
          {r.broker === "xm"
            ? "Have a different XM account?"
            : r.broker === "coinswitch"
              ? "Typed the wrong client ID or phone?"
              : "Used a different email with Elefin?"}{" "}
          <TextButton onClick={onBack}>{r.broker === "elefin" || !r.broker ? "Try another email" : "Try again"}</TextButton>.
        </p>
      </Footer>
    </div>
  );
}

/* ---------------- Step 2: OTP ---------------- */
function OtpStep({ email, onDone, onBack }: { email: string; onDone: (m: Member) => void; onBack: () => void }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(60);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const toast = useToast();

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function verify(code: string) {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ member: Member }>("/api/verify/otp", { body: { code } });
      onDone(r.member);
    } catch (err) {
      setError((err as Error).message);
      setDigits(Array(6).fill(""));
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      while (next.length < 6) next.push("");
      setDigits(next);
      if (clean.length >= 6) verify(clean.slice(0, 6));
      else refs.current[clean.length]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d)) verify(next.join(""));
  }

  async function resend() {
    try {
      await api("/api/verify/resend", { body: {} });
      toast("A new code has been sent.", "success");
      setCooldown(60);
    } catch (err) {
      const ra = err instanceof ApiError ? Number(err.data.retryAfter) : 0;
      if (ra) setCooldown(ra);
      toast((err as Error).message, "error");
    }
  }

  return (
    <div>
      <Heading title="Check your inbox">
        We sent a 6-digit code to <span className="text-white">{email}</span>. Enter it below to confirm the email is yours.
      </Heading>

      <label className="ef-label">Verification code</label>
      <div className="flex gap-2 sm:gap-2.5">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={6}
            value={d}
            disabled={loading}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            }}
            className="ef-input min-w-0 px-0 text-center text-[22px] font-normal"
          />
        ))}
      </div>
      {error && <ErrorText>{error}</ErrorText>}

      <button className="ef-btn mt-11" disabled={loading || digits.some((d) => !d)} onClick={() => verify(digits.join(""))}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />} Verify
      </button>

      <Footer>
        <p>
          Didn&apos;t get it? Check your spam folder, or{" "}
          {cooldown > 0 ? <span className="text-[#6b7282]">resend in {cooldown}s</span> : <TextButton onClick={resend}>send a new code</TextButton>}.
        </p>
        <p>
          Wrong email? <TextButton onClick={onBack}>Start again</TextButton>.
        </p>
      </Footer>
    </div>
  );
}

/* ---------------- Step 3: Telegram ---------------- */
function TelegramStep({ ready: initialReady, member, error, onBack }: { ready: boolean; member: Member; error: string; onBack: () => void }) {
  const [redirecting, setRedirecting] = useState(false);
  // The page may have loaded before an admin saved the login settings, so confirm with the server live.
  const [ready, setReady] = useState(initialReady);
  const [checking, setChecking] = useState(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const r = await api<{ settings: { telegramLoginReady: boolean } }>("/api/state");
      setReady(r.settings.telegramLoginReady);
    } catch {
      /* keep the last known value */
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  return (
    <div>
      <Heading title="Connect Telegram">
        {member.name ? `Welcome, ${member.name.split(" ")[0]}. ` : ""}Your account qualifies with {member.lots} traded lots. Log in with Telegram so we can
        deliver the videos to your chat.
      </Heading>

      <label className="ef-label">Verified account</label>
      <div className="ef-input flex items-center justify-between text-[#c9cdd6]">
        <span className="truncate">{member.email}</span>
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[#4d7bff]" />
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {ready ? (
        <a
          href="/api/telegram/start"
          onClick={() => setRedirecting(true)}
          aria-disabled={redirecting}
          className={`ef-btn mt-11 bg-[#2aabee] hover:bg-[#3db5f2] ${redirecting ? "pointer-events-none opacity-70" : ""}`}
        >
          {redirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TelegramIcon />}
          {redirecting ? "Opening Telegram…" : "Log in with Telegram"}
        </a>
      ) : checking ? (
        <p className="mt-11 flex items-center justify-center gap-2 text-[14px] text-[#a3a9b6]">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking Telegram login…
        </p>
      ) : (
        <div className="mt-11 text-center">
          <p className="text-[14px] text-[#a3a9b6]">Telegram login is not available right now.</p>
          <button type="button" onClick={recheck} className="ef-btn-outline mt-4">
            Try again
          </button>
        </div>
      )}

      <Footer>
        <p>When Telegram asks, allow the bot to send you messages. We never see your Telegram password or chats.</p>
        <p>
          Not you? <TextButton onClick={onBack}>Use a different email</TextButton>.
        </p>
      </Footer>
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M21.94 4.6 18.9 19.04c-.23 1.02-.83 1.27-1.69.79l-4.66-3.44-2.25 2.17c-.25.25-.46.46-.94.46l.34-4.76 8.66-7.83c.38-.34-.08-.52-.58-.19L7.08 13.01 2.47 11.57c-1-.31-1.02-1 .21-1.48L20.66 3.2c.83-.31 1.56.19 1.28 1.4Z" />
    </svg>
  );
}

/* ---------------- Step 4: Deliver ---------------- */
interface VideoItem {
  id: number;
  title: string;
  status: "available" | "cooldown" | "sent";
  lastSentAt: string | null;
  availableAt: string | null;
}

function waitLabel(iso: string) {
  const mins = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}

function DeliverStep({ botUsername, member, onDelivered, onBack }: { botUsername: string; member: Member; onDelivered: (at: string) => void; onBack: () => void }) {
  const [videos, setVideos] = useState<VideoItem[] | null>(null);
  const [sending, setSending] = useState<number | "all" | null>(null);
  const [error, setError] = useState("");
  const [openingBot, setOpeningBot] = useState<string | null>(null);
  const [, tick] = useState(0);
  const toast = useToast();
  const tgUser = member.telegram!;
  const botLink = botUsername ? `https://t.me/${botUsername}` : null;

  const load = useCallback(async () => {
    try {
      const r = await api<{ videos: VideoItem[] }>("/api/videos");
      setVideos(r.videos);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep cooldown countdowns fresh, and reload once a video becomes available again.
  useEffect(() => {
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (videos?.some((v) => v.status === "cooldown" && v.availableAt && new Date(v.availableAt).getTime() <= Date.now())) load();
    }, 30_000);
    return () => clearInterval(t);
  }, [videos, load]);

  async function deliver(target: number | "all") {
    setSending(target);
    setError("");
    try {
      const r = await api<{ report: { sent: number; failed: number; skipped: number }; videos: VideoItem[] }>("/api/deliver", {
        body: target === "all" ? {} : { videoIds: [target] },
      });
      setVideos(r.videos);
      onDelivered(new Date().toISOString());
      const { sent, failed } = r.report;
      toast(
        `${sent} video${sent === 1 ? "" : "s"} sent to your Telegram${failed ? `, ${failed} couldn't be sent` : ""}.`,
        failed ? "info" : "success"
      );
    } catch (err) {
      // The bot hasn't been started yet: send the user to it. Pressing Start delivers the requested videos.
      if (err instanceof ApiError && err.data.code === "need_start" && typeof err.data.botUrl === "string") {
        setOpeningBot(err.data.botUrl);
        setTimeout(() => window.location.assign(err.data.botUrl as string), 900);
        return;
      }
      setError((err as Error).message);
      if (err instanceof ApiError && Array.isArray(err.data.videos)) setVideos(err.data.videos as VideoItem[]);
    } finally {
      setSending(null);
    }
  }

  if (openingBot) {
    return (
      <div>
        <Heading title="Open Telegram to continue">
          Press <span className="text-white">Start</span> in the bot and your videos will be sent straight away. Opening Telegram…
        </Heading>
        <a href={openingBot} className="ef-btn">
          Open @{botUsername}
        </a>
        <Footer>
          <p>
            Telegram didn&apos;t open? Use the button above, then come back here any time. <TextButton onClick={() => setOpeningBot(null)}>Back to videos</TextButton>.
          </p>
        </Footer>
      </div>
    );
  }

  const available = videos?.filter((v) => v.status === "available") ?? [];

  return (
    <div>
      <Heading title="Your videos">Choose a video to receive it in your Telegram chat, or get everything that&apos;s available at once.</Heading>

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#262c3b] bg-[#11151f] px-4 py-3">
        {tgUser.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tgUser.photoUrl} alt="" className="h-8 w-8 rounded-full" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#0a47ec]/25 text-[14px] text-[#9db4ff]">{(tgUser.name || "?")[0]}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-[15px] text-[#e7e9ee]">{tgUser.name || "Telegram user"}</span>
        <span className="truncate text-[13px] text-[#8a91a0]">{tgUser.username ? `@${tgUser.username}` : tgUser.id}</span>
      </div>

      {!videos ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[#262c3b] py-10 text-[14px] text-[#8a91a0]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading videos…
        </div>
      ) : videos.length === 0 ? (
        <p className="rounded-xl border border-[#262c3b] px-4 py-8 text-center text-[14px] text-[#a3a9b6]">No videos are available yet. Please check back soon.</p>
      ) : (
        <ul className="divide-y divide-[#262c3b] overflow-hidden rounded-xl border border-[#262c3b]">
          {videos.map((v, i) => {
            const busy = sending === v.id || (sending === "all" && v.status === "available");
            return (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className="w-5 shrink-0 text-[13px] tabular-nums text-[#6b7282]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] text-white">{v.title}</div>
                  <div className="mt-0.5 text-[13px] text-[#8a91a0]">
                    {v.status === "available"
                      ? v.lastSentAt
                        ? "Available again"
                        : "Not received yet"
                      : v.status === "cooldown"
                        ? `Sent · available again in ${waitLabel(v.availableAt!)}`
                        : "Sent to your Telegram"}
                  </div>
                </div>
                {v.status === "available" ? (
                  <button
                    onClick={() => deliver(v.id)}
                    disabled={sending !== null}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#0a47ec] px-4 text-[14px] font-medium text-white transition hover:bg-[#1f57f5] disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Get
                  </button>
                ) : (
                  <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#2c3343] px-3.5 text-[13px] text-[#8a91a0]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {videos && videos.length > 0 && (
        <button onClick={() => deliver("all")} disabled={sending !== null || available.length === 0} className="ef-btn mt-6">
          {sending === "all" && <Loader2 className="h-4 w-4 animate-spin" />}
          {sending === "all" ? "Sending videos…" : available.length ? `Get all (${available.length})` : "Nothing new to get"}
        </button>
      )}

      <Footer>
        {botLink && (
          <p>
            Videos arrive in your chat with{" "}
            <a href={botLink} target="_blank" rel="noreferrer" className="ef-link">
              @{botUsername}
            </a>
            . New videos appear here as they&apos;re added.
          </p>
        )}
        <p>
          Signed in as {member.email}. <TextButton onClick={onBack}>Sign out</TextButton>.
        </p>
      </Footer>
    </div>
  );
}
