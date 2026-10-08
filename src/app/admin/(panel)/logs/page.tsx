"use client";

import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dot, Empty, Loading, PageHeader, Pagination, SearchInput, Tabs } from "@/components/admin-ui";
import { useToast } from "@/components/toast";
import { api, fmtDate } from "@/lib/api";

type Row = Record<string, string | number | null>;
type LogType = "deliveries" | "lookups";

export default function LogsPage() {
  const [type, setType] = useState<LogType>("deliveries");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; total: number; pages: number } | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    setData(null);
    api<{ rows: Row[]; total: number; pages: number }>(`/api/admin/logs?${new URLSearchParams({ type, q: query, page: String(page) })}`)
      .then(setData)
      .catch((e) => toast(e.message, "error"));
  }, [type, query, page, toast]);
  useEffect(load, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <PageHeader title="Activity logs" subtitle="Every Telegram delivery and every eligibility check." />
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-[#262a33] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <Tabs<LogType>
            value={type}
            onChange={(t) => {
              setType(t);
              setPage(1);
            }}
            tabs={[
              { id: "deliveries", label: "Deliveries" },
              { id: "lookups", label: "Eligibility checks" },
            ]}
          />
          <SearchInput value={q} onChange={setQ} placeholder={type === "lookups" ? "Email or IP" : "Email, @username or video"} />
        </div>

        {!data ? (
          <Loading />
        ) : data.rows.length === 0 ? (
          <Empty icon={<ListChecks />} title="Nothing logged yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              {type === "deliveries" ? (
                <table className="table min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-[170px]">Time</th>
                      <th>Member</th>
                      <th>Video</th>
                      <th className="w-[260px]">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-[#8b919d]">{fmtDate(r.created_at as string)}</td>
                        <td>
                          <span className="text-[#eceef2]">{r.email ?? "—"}</span>
                          <span className="ml-2 text-[12px] text-[#7d8390]">{r.telegram_username ? `@${r.telegram_username}` : r.telegram_id}</span>
                        </td>
                        <td className="text-[#b4b9c4]">{r.title ?? "Deleted video"}</td>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <Dot tone={r.status === "sent" ? "ok" : "error"} />
                            <span className="text-[#b4b9c4]">{r.status === "sent" ? "Sent" : "Failed"}</span>
                          </span>
                          {r.error && <div className="truncate text-[12px] text-[#f19aa5]" title={String(r.error)}>{r.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="table min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-[170px]">Time</th>
                      <th>Email</th>
                      <th className="w-[80px] text-right">Lots</th>
                      <th className="w-[280px]">Result</th>
                      <th className="w-[130px]">IP address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-[#8b919d]">{fmtDate(r.created_at as string)}</td>
                        <td className="text-[#eceef2]">{r.email}</td>
                        <td className="text-right tabular-nums text-[#b4b9c4]">{r.lots ?? "—"}</td>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <Dot tone={!r.found ? "muted" : r.eligible ? "ok" : "warn"} />
                            <span className="text-[#b4b9c4]">{!r.found ? "Not found" : r.eligible ? "Eligible" : "Not eligible"}</span>
                          </span>
                          {r.reason && !r.eligible && <div className="truncate text-[12px] text-[#7d8390]" title={String(r.reason)}>{r.reason}</div>}
                        </td>
                        <td className="font-mono text-[12px] text-[#7d8390]">{r.ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Pagination page={page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
