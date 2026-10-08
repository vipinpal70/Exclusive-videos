"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Video as VideoIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin-context";
import { useConfirm } from "@/components/confirm";
import { ActionMenu, Dot, Empty, Loading, Modal, PageHeader, SearchInput, Tabs, Toggle } from "@/components/admin-ui";
import { useToast } from "@/components/toast";
import { api, timeAgo } from "@/lib/api";

interface Video {
  id: number;
  title: string;
  link: string;
  from_chat_id: string;
  message_id: string;
  chat_title: string | null;
  caption: string | null;
  sort_order: number;
  is_active: number;
  verify_status: "unverified" | "ok" | "error";
  verify_message: string | null;
  verified_at: string | null;
  sent_count: number;
}

interface VerifyResult {
  ok: boolean;
  message: string;
}

type Filter = "all" | "active" | "inactive" | "problems";

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [editing, setEditing] = useState<Partial<Video> | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const toast = useToast();
  const edit = useAdmin().can("videos.manage");
  const confirm = useConfirm();

  const load = useCallback(() => {
    api<{ videos: Video[] }>("/api/admin/videos")
      .then((r) => setVideos(r.videos))
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    if (!videos) return [];
    const s = q.trim().toLowerCase();
    return videos.filter((v) => {
      if (filter === "active" && !v.is_active) return false;
      if (filter === "inactive" && v.is_active) return false;
      if (filter === "problems" && v.verify_status !== "error") return false;
      if (s && !`${v.title} ${v.caption ?? ""} ${v.chat_title ?? ""} ${v.link}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [videos, filter, q]);
  const canReorder = edit && filter === "all" && !q.trim();

  const counts = useMemo(
    () => ({
      active: videos?.filter((v) => v.is_active).length ?? 0,
      problems: videos?.filter((v) => v.verify_status === "error").length ?? 0,
    }),
    [videos]
  );

  async function verify(v: Video) {
    setVerifying(v.id);
    try {
      const r = await api<{ verify: VerifyResult }>(`/api/admin/videos/${v.id}`, { body: {} });
      toast(r.verify.message, r.verify.ok ? "success" : "error");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setVerifying(null);
    }
  }

  async function setActive(v: Video, active: boolean) {
    setVideos((list) => list!.map((x) => (x.id === v.id ? { ...x, is_active: active ? 1 : 0 } : x)));
    try {
      await api(`/api/admin/videos/${v.id}`, { method: "PUT", body: { is_active: active } });
    } catch (e) {
      toast((e as Error).message, "error");
      load();
    }
  }

  async function remove(v: Video) {
    const ok = await confirm({
      title: "Delete video?",
      message: (
        <>
          <span className="text-[#eceef2]">{v.title}</span> will be removed from the list and won't be sent to anyone again. The message in your Telegram
          channel is not affected.
        </>
      ),
      confirmLabel: "Delete video",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/videos/${v.id}`, { method: "DELETE" });
      toast("Video deleted.", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function saveOrder(list: Video[]) {
    setVideos(list);
    try {
      await api("/api/admin/videos/reorder", { body: { ids: list.map((v) => v.id) } });
    } catch (e) {
      toast((e as Error).message, "error");
      load();
    }
  }

  function move(v: Video, dir: -1 | 1) {
    if (!videos) return;
    const i = videos.findIndex((x) => x.id === v.id);
    const j = i + dir;
    if (j < 0 || j >= videos.length) return;
    const list = [...videos];
    [list[i], list[j]] = [list[j], list[i]];
    saveOrder(list);
  }

  function onDrop(targetId: number) {
    const from = videos?.findIndex((v) => v.id === dragId) ?? -1;
    const to = videos?.findIndex((v) => v.id === targetId) ?? -1;
    setDragId(null);
    setOverId(null);
    if (!videos || from < 0 || to < 0 || from === to) return;
    const list = [...videos];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    saveOrder(list);
  }

  return (
    <>
      <PageHeader
        title="Videos"
        subtitle="Telegram messages copied to every eligible member, in this order."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setHelp(true)}>
              <CircleHelp className="h-3.5 w-3.5" /> Setup guide
            </button>
            {edit && (
              <button className="btn btn-primary" onClick={() => setEditing({ is_active: 1 })}>
                <Plus className="h-3.5 w-3.5" /> Add video
              </button>
            )}
          </>
        }
      />

      {!videos ? (
        <div className="card">
          <Loading />
        </div>
      ) : videos.length === 0 ? (
        <div className="card">
          <Empty icon={<VideoIcon />} title="No videos yet">
            Upload your videos to a private Telegram channel, add the bot as an admin, then paste each message link here.
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn btn-secondary" onClick={() => setHelp(true)}>
                Setup guide
              </button>
              {edit && (
                <button className="btn btn-primary" onClick={() => setEditing({ is_active: 1 })}>
                  <Plus className="h-3.5 w-3.5" /> Add video
                </button>
              )}
            </div>
          </Empty>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-[#262a33] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs<Filter>
              value={filter}
              onChange={setFilter}
              tabs={[
                { id: "all", label: `All ${videos.length}` },
                { id: "active", label: `Active ${counts.active}` },
                { id: "inactive", label: `Inactive ${videos.length - counts.active}` },
                { id: "problems", label: `Issues ${counts.problems}` },
              ]}
            />
            <SearchInput value={q} onChange={setQ} placeholder="Search videos" />
          </div>

          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th className="w-8 !px-0" />
                  <th className="w-10">#</th>
                  <th>Video</th>
                  <th className="w-[200px]">Source</th>
                  <th className="w-[130px]">Status</th>
                  <th className="w-[70px] text-right">Sent</th>
                  <th className="w-[70px]">Active</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="!h-20 text-center text-[#8b919d]">
                      No videos match this filter.
                    </td>
                  </tr>
                )}
                {shown.map((v) => {
                  const pos = videos.findIndex((x) => x.id === v.id);
                  return (
                    <tr
                      key={v.id}
                      draggable={canReorder}
                      onDragStart={() => setDragId(v.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      onDragOver={(e) => {
                        if (!canReorder) return;
                        e.preventDefault();
                        setOverId(v.id);
                      }}
                      onDrop={() => onDrop(v.id)}
                      className={`${dragId === v.id ? "opacity-40" : ""} ${overId === v.id && dragId !== v.id ? "shadow-[inset_0_2px_0_var(--color-brand-500)]" : ""}`}
                    >
                      <td className="!px-0 text-center">
                        <GripVertical
                          className={`mx-auto h-3.5 w-3.5 ${canReorder ? "cursor-grab text-[#4d5360] hover:text-[#8b919d]" : "text-[#2c313b]"}`}
                          aria-label="Drag to reorder"
                        />
                      </td>
                      <td className="tabular-nums text-[#8b919d]">{pos + 1}</td>
                      <td className="max-w-0">
                        {edit ? (
                          <button className="block max-w-full truncate text-left font-medium text-[#eceef2] hover:text-brand-300" onClick={() => setEditing(v)}>
                            {v.title}
                          </button>
                        ) : (
                          <div className="truncate font-medium text-[#eceef2]">{v.title}</div>
                        )}
                        <div className="truncate text-[12px] text-[#7d8390]">{v.caption ? stripHtml(v.caption) : "Original caption"}</div>
                      </td>
                      <td>
                        <div className="truncate text-[#b4b9c4]" title={v.from_chat_id}>
                          {v.chat_title || v.from_chat_id}
                        </div>
                        <a href={v.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[#7d8390] hover:text-brand-300">
                          Message #{v.message_id} <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td>
                        {verifying === v.id ? (
                          <span className="inline-flex items-center gap-1.5 text-[#8b919d]">
                            <Loader2 className="h-3 w-3 animate-spin" /> Checking
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5"
                            title={[v.verify_message, v.verified_at && `Checked ${timeAgo(v.verified_at)}`].filter(Boolean).join("\n")}
                          >
                            <Dot tone={v.verify_status === "ok" ? "ok" : v.verify_status === "error" ? "error" : "muted"} />
                            <span className={v.verify_status === "error" ? "text-[#f19aa5]" : "text-[#b4b9c4]"}>
                              {v.verify_status === "ok" ? "Ready" : v.verify_status === "error" ? "Needs attention" : "Not checked"}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums text-[#b4b9c4]">{v.sent_count}</td>
                      <td>
                        <Toggle size="sm" checked={!!v.is_active} onChange={(a) => setActive(v, a)} disabled={!edit} />
                      </td>
                      <td className="text-right">
                        <ActionMenu
                          actions={
                            !edit
                              ? [{ label: "Open in Telegram", icon: <ExternalLink />, onClick: () => window.open(v.link, "_blank", "noopener") }]
                              : [
                            { label: "Edit", icon: <Pencil />, onClick: () => setEditing(v) },
                            { label: "Check permissions", icon: <RefreshCw />, onClick: () => verify(v), disabled: verifying === v.id },
                            { label: "Open in Telegram", icon: <ExternalLink />, onClick: () => window.open(v.link, "_blank", "noopener") },
                            {
                              label: v.is_active ? "Deactivate" : "Activate",
                              icon: v.is_active ? <EyeOff /> : <Eye />,
                              onClick: () => setActive(v, !v.is_active),
                            },
                            { label: "Move up", icon: <ArrowUp />, onClick: () => move(v, -1), disabled: pos === 0, separator: true },
                            { label: "Move down", icon: <ArrowDown />, onClick: () => move(v, 1), disabled: pos === videos.length - 1 },
                            { label: "Delete", icon: <Trash2 />, onClick: () => remove(v), danger: true, separator: true },
                                ]
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-[#262a33] px-3 py-2 text-[12px] text-[#7d8390]">
            <span>
              {counts.active} of {videos.length} active
              {counts.problems > 0 && <span className="text-[#f19aa5]"> · {counts.problems} need attention</span>}
            </span>
            <span className="hidden sm:inline">{!edit ? "View only" : canReorder ? "Drag rows to reorder" : "Clear filters to reorder"}</span>
          </div>
        </div>
      )}

      <VideoModal video={editing} onClose={() => setEditing(null)} onSaved={load} />

      <Modal open={help} onClose={() => setHelp(false)} title="Setup guide" footer={<button className="btn btn-secondary" onClick={() => setHelp(false)}>Close</button>}>
        <ol className="list-decimal space-y-2.5 pl-4 text-[13px] leading-relaxed text-[#b4b9c4]">
          <li>Create a private Telegram channel and upload your mentorship videos to it.</li>
          <li>Add your bot to the channel as an administrator.</li>
          <li>
            Right-click a video and choose <span className="text-[#eceef2]">Copy Message Link</span>, for example{" "}
            <code className="rounded bg-[#232833] px-1 py-0.5 text-[12px]">https://t.me/c/1234567890/45</code>.
          </li>
          <li>
            Paste it here. Saving checks that the bot is an admin. Set a test chat ID in Settings → Telegram to also receive a test copy.
          </li>
          <li>
            A caption replaces the original one and supports HTML such as <code className="rounded bg-[#232833] px-1 py-0.5 text-[12px]">&lt;b&gt;</code>,{" "}
            <code className="rounded bg-[#232833] px-1 py-0.5 text-[12px]">&lt;i&gt;</code> and{" "}
            <code className="rounded bg-[#232833] px-1 py-0.5 text-[12px]">&lt;a href&gt;</code>. Leave it empty to keep the original.
          </li>
        </ol>
      </Modal>
    </>
  );
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function VideoModal({ video, onClose, onSaved }: { video: Partial<Video> | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [caption, setCaption] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!video) return;
    setTitle(video.title ?? "");
    setLink(video.link ?? "");
    setCaption(video.caption ?? "");
    setActive(video.is_active !== 0);
    setVerify(null);
  }, [video]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setVerify(null);
    try {
      const body = { title, link, caption, is_active: active };
      const r = video?.id
        ? await api<{ verify: VerifyResult | null }>(`/api/admin/videos/${video.id}`, { method: "PUT", body })
        : await api<{ verify: VerifyResult | null }>("/api/admin/videos", { body });
      onSaved();
      if (r.verify && !r.verify.ok) {
        setVerify(r.verify);
        toast("Saved, but the bot can't copy this message yet.", "error");
      } else {
        toast(r.verify ? `Saved. ${r.verify.message}` : "Video saved.", "success");
        onClose();
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!video}
      onClose={onClose}
      title={video?.id ? "Edit video" : "Add video"}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {verify ? "Close" : "Cancel"}
          </button>
          <button type="submit" form="video-form" className="btn btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {video?.id ? "Save changes" : "Add video"}
          </button>
        </>
      }
    >
      <form id="video-form" onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="v-title">
            Title
          </label>
          <input id="v-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson 1: Market structure" required autoFocus />
          <p className="hint">Only shown in the admin panel.</p>
        </div>
        <div>
          <label className="label" htmlFor="v-link">
            Message link
          </label>
          <input
            id="v-link"
            className="input font-mono text-[12px]"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://t.me/c/1234567890/45"
            required
          />
          <p className="hint">Right-click the message in your private channel and choose Copy Message Link.</p>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="v-caption">
              Caption <span className="font-normal text-[#7d8390]">(optional)</span>
            </label>
            <span className="text-[11px] tabular-nums text-[#646b78]">{caption.length}/1024</span>
          </div>
          <textarea
            id="v-caption"
            className="input min-h-[96px] resize-y"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="<b>Lesson 1</b> — Understanding market structure"
            maxLength={1024}
          />
          <p className="hint">Replaces the original caption. HTML formatting is supported.</p>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-[5px] border border-[#262a33] bg-[#13161b] px-3 py-2.5">
          <span>
            <span className="block text-[13px] text-[#eceef2]">Active</span>
            <span className="block text-[12px] text-[#7d8390]">Include this video when members request their videos.</span>
          </span>
          <Toggle checked={active} onChange={setActive} />
        </label>
        {verify && !verify.ok && (
          <div className="flex gap-2 rounded-[5px] border border-[#4a2429] bg-[#2a1518] px-3 py-2.5 text-[13px] text-[#f5b8c0]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Permission check failed</div>
              <div className="mt-0.5 text-[12px] leading-relaxed opacity-90">{verify.message}</div>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
