"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { markAdminTab } from "@/lib/admin-tab";
import { api } from "@/lib/api";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/admin/setup").then((r) => !r.needsSetup && router.replace("/admin/login")).catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/admin/setup", { body: { username, password } });
      markAdminTab();
      router.replace("/admin/settings");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create admin account"
      subtitle="First-time setup. This page locks after use."
      onSubmit={submit}
      {...{ username, setUsername, password, setPassword, loading, error }}
      button="Create account"
      passwordHint="At least 8 characters."
    />
  );
}
