"use client";

import { useEffect, useState } from "react";
import { hasAdminTab } from "@/lib/admin-tab";

/**
 * For logins without "Remember me", only the tab that signed in may use the panel.
 * Other tabs (or this tab after a browser restart) are signed out before any content loads.
 */
export function TabGuard({ remembered, children }: { remembered: boolean; children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(remembered);

  useEffect(() => {
    if (remembered) return;
    if (hasAdminTab()) {
      setAllowed(true);
      return;
    }
    fetch("/api/admin/logout", { method: "POST" }).finally(() => window.location.replace("/admin/login?ended=1"));
  }, [remembered]);

  return allowed ? <>{children}</> : null;
}
