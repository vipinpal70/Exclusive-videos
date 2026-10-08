"use client";

import { createContext, useContext } from "react";
import { can as canDo, type AdminUser, type Permission } from "@/lib/permissions";

const Ctx = createContext<AdminUser | null>(null);

export function AdminProvider({ admin, children }: { admin: AdminUser; children: React.ReactNode }) {
  return <Ctx.Provider value={admin}>{children}</Ctx.Provider>;
}

/** The signed-in admin plus a `can(permission)` helper for hiding or disabling controls. */
export function useAdmin() {
  const admin = useContext(Ctx);
  return { admin, can: (p: Permission) => canDo(admin, p), isSuper: !!admin?.isSuper };
}

export function ViewOnlyBadge() {
  return <span className="badge bg-[#232833] text-[#8b919d]">View only</span>;
}
