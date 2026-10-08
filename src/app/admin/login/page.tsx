"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { clearAdminTab, markAdminTab } from "@/lib/admin-tab";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/admin/setup").then((r) => r.needsSetup && router.replace("/admin/setup")).catch(() => {});
    if (new URLSearchParams(window.location.search).get("ended")) {
      setNotice("Your session was limited to another tab. Sign in again, or tick Remember me to stay signed in across tabs.");
    }
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/admin/login", { body: { username, password, remember } });
      if (remember) clearAdminTab();
      else markAdminTab();
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="Manage videos, members and integrations."
      onSubmit={submit}
      {...{ username, setUsername, password, setPassword, loading, error, notice }}
      remember={remember}
      setRemember={setRemember}
      button="Sign in"
    />
  );
}
