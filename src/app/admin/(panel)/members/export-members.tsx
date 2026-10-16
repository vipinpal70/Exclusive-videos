"use client";

import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/admin-ui";
import { useToast } from "@/components/toast";

type Format = "xlsx" | "csv";

const FORMATS: { id: Format; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: "xlsx", label: "Excel (.xlsx)", desc: "Opens in Excel, Google Sheets or Numbers, with a bold, frozen header row and filters.", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: "csv", label: "CSV (.csv)", desc: "Plain comma-separated text, for importing into other tools.", icon: <FileText className="h-4 w-4" /> },
];

/** Downloads every member. The file is fetched with the admin session and saved from memory. */
export function ExportMembers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [format, setFormat] = useState<Format>("xlsx");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/members/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Export failed (HTTP ${res.status}).`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `members.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(`Downloaded ${name}.`, "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Export members"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={download} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Preparing…" : "Download"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-[#b4b9c4]">
          Every member, from all brokers and filters: email, account IDs, phone, eligibility, lots, Telegram details, deliveries and status.
          The file contains personal data, so keep it somewhere safe.
        </p>
        <div className="grid gap-2" role="radiogroup" aria-label="File format">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={format === f.id}
              onClick={() => setFormat(f.id)}
              className={`flex items-start gap-3 rounded-[6px] border px-3 py-2.5 text-left transition ${
                format === f.id ? "border-brand-500 bg-[#141c2e]" : "border-[#2a2f3a] hover:border-[#3a404d]"
              }`}
            >
              <span className={`mt-0.5 ${format === f.id ? "text-brand-300" : "text-[#7d8390]"}`}>{f.icon}</span>
              <span>
                <span className="block text-[13px] font-medium text-[#eceef2]">{f.label}</span>
                <span className="block text-[12px] text-[#7d8390]">{f.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
