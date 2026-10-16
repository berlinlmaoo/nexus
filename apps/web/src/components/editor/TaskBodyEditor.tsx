import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { Check, CloudOff, Loader2, Lock } from "lucide-react";
import { ApiError, nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import type { CollabUser } from "@/lib/collab-provider";
import { BlockEditor, type RestSaveResult, type SaveStatus } from "./BlockEditor";
import { useEditorCtx } from "./useEditorCtx";

/**
 * A task's description as a block document (owner-approved item #5). Stored as TipTap JSON in TaskBody
 * plus its text form in Task.description, which the released apps keep reading and editing.
 */
export function TaskBodyEditor({ taskId, projectId, onOpenTask }: { taskId: string; projectId: string | null; onOpenTask?: (taskId: string) => void }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const body = useQuery({ queryKey: ["task-body", taskId], queryFn: () => nexusApi.taskBody(taskId), retry: false, staleTime: 30_000 });
  // The text this editor started from (only from the first load and our own saves): a REST save is
  // refused when the stored text moved on meanwhile.
  const base = useRef<string | null>(null);
  if (base.current === null && body.data) base.current = body.data.text;
  const [status, setStatus] = useState<SaveStatus>("connecting");
  const [peers, setPeers] = useState<CollabUser[]>([]);

  const openTask = useCallback((id: string) => {
    if (onOpenTask) onOpenTask(id);
    else navigate({ to: "/tasks/$taskId", params: { taskId: id } });
  }, [navigate, onOpenTask]);
  const ctx = useEditorCtx(projectId, `/tasks/${taskId}`, openTask);

  const onRestSave = useCallback(async (doc: JSONContent, force: boolean): Promise<RestSaveResult> => {
    try {
      const res = await nexusApi.saveTaskBody(taskId, doc, force ? undefined : base.current ?? undefined);
      base.current = res.text;
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const p = e.payload as { doc?: JSONContent; text?: string } | null;
        base.current = p?.text ?? base.current;
        return { ok: false, conflict: true, doc: p?.doc ?? { type: "doc", content: [{ type: "paragraph" }] } };
      }
      return { ok: false, error: e instanceof Error ? e.message : "error" };
    }
  }, [taskId]);

  const onStatus = useCallback((s: SaveStatus, info: { peers: CollabUser[] }) => {
    setStatus(s);
    setPeers(info.peers);
  }, []);

  if (body.isLoading) return <div className="flex h-7 items-center px-1 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (body.isError || !body.data) return <p className="text-sm text-muted-foreground">{t("Couldn't load the description.")}</p>;

  return (
    <div>
      <BlockEditor
        roomKey={`taskbody:${taskId}`}
        initialDoc={body.data.doc as JSONContent}
        canEdit={body.data.canEdit}
        ctx={ctx}
        variant="embedded"
        className="is-compact"
        placeholder={t("Add a description… type '/' for blocks, '@' to mention")}
        onRestSave={onRestSave}
        onStatus={onStatus}
      />
      {/* The save line takes no room until it has something to say, so an empty body stays one line. */}
      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted-foreground empty:mt-0" aria-live="polite">
        {peers.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="flex -space-x-1">
              {peers.slice(0, 3).map((p) => <AvatarFace key={p.id} name={p.name} avatar={p.avatar ?? null} seed={p.id} size={16} />)}
            </span>
            {t("{names} editing", { names: peers.map((p) => p.name.split(" ")[0]).join(", ") })}
          </span>
        )}
        {status === "saving" && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{t("Saving…")}</span>}
        {status === "saved" && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />{t("Saved")}</span>}
        {status === "offline" && <span className="inline-flex items-center gap-1"><CloudOff className="h-3 w-3" />{t("Offline")}</span>}
        {status === "readonly" && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />{t("View only")}</span>}
        {status === "error" && <span className="text-destructive">{t("Couldn't save.")}</span>}
      </div>
    </div>
  );
}
