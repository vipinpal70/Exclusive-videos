"use client";

import { ChevronRight, KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin-context";
import { useConfirm } from "@/components/confirm";
import { ActionMenu, Loading, Modal, PageHeader, Toggle } from "@/components/admin-ui";
import { useToast } from "@/components/toast";
import { api, fmtDate } from "@/lib/api";
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/permissions";

interface AdminRow {
  id: number;
  username: string;
  isSuper: boolean;
  permissions: Permission[];
  lastLoginAt: string | null;
  createdAt: string;
}

function accessLabel(a: Pick<AdminRow, "isSuper" | "permissions">) {
  if (a.isSuper) return "Super admin";
  if (a.permissions.length === 0) return "Read only";
  if (a.permissions.length === ALL_PERMISSIONS.length) return "All permissions";
  return `${a.permissions.length} of ${ALL_PERMISSIONS.length} permissions`;
}

export default function AdminsPage() {
  const { admin: me, isSuper } = useAdmin();
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [editing, setEditing] = useState<AdminRow | "new" | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => {
    api<{ admins: AdminRow[] }>("/api/admin/admins")
      .then((r) => setAdmins(r.admins))
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  async function remove(a: AdminRow) {
    const ok = await confirm({
      title: "Delete admin?",
      message: (
        <>
          <span className="text-[#eceef2]">{a.username}</span> will lose access to the admin panel and be signed out immediately.
        </>
      ),
      confirmLabel: "Delete admin",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api<{ message: string }>(`/api/admin/admins/${a.id}`, { method: "DELETE" });
      toast(r.message, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHeader
        title="Admins"
        subtitle={isSuper ? "Manage who can sign in and what each admin can change." : "People who can sign in to this panel."}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setPwOpen(true)}>
              <KeyRound className="h-3.5 w-3.5" /> Change my password
            </button>
            {isSuper && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus className="h-3.5 w-3.5" /> Add admin
              </button>
            )}
          </>
        }
      />

      <div className="card overflow-hidden">
        {!admins ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>Username</th>
                  <th className="w-[200px]">Access</th>
                  <th className="w-[180px]">Last sign-in</th>
                  <th className="w-[180px]">Created</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className={isSuper ? "cursor-pointer" : ""} onClick={() => isSuper && setEditing(a)}>
                    <td>
                      <span className="text-[#eceef2]">{a.username}</span>
                      {a.id === me?.id && <span className="badge ml-2 bg-[#1b2a52] text-brand-300">You</span>}
                    </td>
                    <td>
                      {a.isSuper ? (
                        <span className="inline-flex items-center gap-1.5 text-[#d4d7de]">
                          <ShieldCheck className="h-3.5 w-3.5 text-brand-400" /> Super admin
                        </span>
                      ) : (
                        <span className="text-[#b4b9c4]" title={a.permissions.map((p) => PERMISSIONS.find((x) => x.key === p)?.label).join("\n")}>
                          {accessLabel(a)}
                        </span>
                      )}
                    </td>
                    <td className="text-[#8b919d]">{fmtDate(a.lastLoginAt)}</td>
                    <td className="text-[#8b919d]">{fmtDate(a.createdAt)}</td>
                    <td className="text-right">
                      {isSuper && (
                        <ActionMenu
                          actions={[
                            { label: "Edit permissions", icon: <Pencil />, onClick: () => setEditing(a) },
                            { label: "Delete admin", icon: <Trash2 />, onClick: () => remove(a), danger: true, separator: true, disabled: a.id === me?.id },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isSuper && <div className="border-t border-[#262a33] px-3 py-2 text-[12px] text-[#7d8390]">Only super admins can add or change admins.</div>}
      </div>

      <AdminModal target={editing} meId={me?.id} onClose={() => setEditing(null)} onSaved={load} />
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

function AdminModal({ target, meId, onClose, onSaved }: { target: AdminRow | "new" | null; meId?: number; onClose: () => void; onSaved: () => void }) {
  const isNew = target === "new";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSuper, setIsSuper] = useState(false);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [showPerms, setShowPerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const self = !isNew && target?.id === meId;

  useEffect(() => {
    if (!target) return;
    setPassword("");
    if (target === "new") {
      setUsername("");
      setIsSuper(false);
      setPerms([]);
      setShowPerms(false);
    } else {
      setUsername(target.username);
      setIsSuper(target.isSuper);
      setPerms(target.isSuper ? ALL_PERMISSIONS : target.permissions);
      // Open the list when the admin has custom access so it's visible straight away.
      setShowPerms(!target.isSuper && target.permissions.length > 0);
    }
  }, [target]);

  function preset(kind: "super" | "readonly") {
    if (kind === "super") {
      setIsSuper(true);
      setPerms(ALL_PERMISSIONS);
    } else {
      setIsSuper(false);
      setPerms([]);
    }
  }

  function toggle(p: Permission, on: boolean) {
    setIsSuper(false);
    setPerms((list) => (on ? ALL_PERMISSIONS.filter((x) => x === p || list.includes(x)) : list.filter((x) => x !== p)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { username, password: password || undefined, isSuper, permissions: perms };
      const r = isNew
        ? await api<{ message: string }>("/api/admin/admins", { body })
        : await api<{ message: string }>(`/api/admin/admins/${(target as AdminRow).id}`, { method: "PUT", body });
      toast(r.message, "success");
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const current = isSuper ? "super" : perms.length === 0 ? "readonly" : "custom";

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={isNew ? "Add admin" : `Edit ${typeof target === "object" && target ? target.username : "admin"}`}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="admin-form" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {isNew ? "Create admin" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="admin-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="a-user">
              Username
            </label>
            <input id="a-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={isNew} />
          </div>
          <div>
            <label className="label" htmlFor="a-pw">
              {isNew ? "Password" : "New password"}
            </label>
            <input
              id="a-pw"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={isNew}
              minLength={8}
              placeholder={isNew ? "" : "Leave blank to keep"}
            />
          </div>
        </div>

        <div>
          <span className="label">Access</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["super", "Super admin", "Every permission, plus adding and editing any admin."],
                ["readonly", "Read only", "Can view every page but can't change anything."],
              ] as const
            ).map(([k, label, desc]) => {
              const selected = current === k;
              const locked = self && isSuper && k === "readonly";
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={locked}
                  onClick={() => preset(k)}
                  className={`flex gap-2.5 rounded-[5px] border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected ? "border-brand-500 bg-[#151c2e]" : "border-[#323743] hover:border-[#424857] hover:bg-[#1a1d24]"
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${selected ? "border-brand-500" : "border-[#4d5360]"}`}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
                  </span>
                  <span>
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#eceef2]">
                      {k === "super" && <ShieldCheck className="h-3.5 w-3.5 text-brand-400" />}
                      {label}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[#7d8390]">{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 overflow-hidden rounded-[5px] border border-[#262a33]">
            <button
              type="button"
              onClick={() => setShowPerms((s) => !s)}
              aria-expanded={showPerms}
              className="flex w-full items-center gap-2 bg-[#13161b] px-3 py-2 text-left text-[13px] text-[#d4d7de] hover:bg-[#1a1d24]"
            >
              <ChevronRight className={`h-3.5 w-3.5 text-[#7d8390] transition-transform ${showPerms ? "rotate-90" : ""}`} />
              Edit permissions
              <span className="ml-auto text-[12px] text-[#7d8390]">
                {isSuper ? "All" : perms.length === 0 ? "None" : `${perms.length} of ${ALL_PERMISSIONS.length}`}
              </span>
            </button>
            {showPerms && (
              <div className="divide-y divide-[#20242c] border-t border-[#262a33]">
                {PERMISSIONS.map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-[#1a1d24]">
                    <div>
                      <div className="text-[13px] text-[#eceef2]">{p.label}</div>
                      <div className="text-[12px] text-[#7d8390]">{p.desc}</div>
                    </div>
                    <Toggle size="sm" checked={perms.includes(p.key)} onChange={(v) => toggle(p.key, v)} disabled={self && isSuper} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="hint">
            {self && isSuper
              ? "You can't remove your own super admin access. Ask another super admin."
              : current === "custom"
                ? "Custom access: this admin can only change the areas switched on above."
                : "Turn on individual permissions to give limited edit access."}
          </p>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setCurrent("");
      setPassword("");
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/admin/account", { body: { current, password } });
      toast(r.message, "success");
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change my password"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pw-form" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Update password
          </button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="pw-current">
            Current password
          </label>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="pw-new">
            New password
          </label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <p className="hint">At least 8 characters.</p>
        </div>
      </form>
    </Modal>
  );
}
