import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, Redo2, Sheet as SheetIcon, Undo2, Upload, X } from "lucide-react";
import { nexusApi, type NexusSheet, type NexusSheetColumn, type NexusSheetRow } from "@/lib/nexus-api";
import { useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { celebrate } from "@/components/Celebration";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/Avatar";
import { CellCommentThread } from "./CellComments";
import { useSheetRealtime } from "./use-sheet-realtime";
import { SheetGrid } from "./SheetGrid";
import { useSheetUndo } from "./use-sheet-undo";
import { editValue, formatCell } from "./sheet-types";

/**
 * The Spreadsheet tab. Free-form rows that belong to nothing — unlike the Table view, whose rows are
 * always tasks. Every project gets one automatically; the sheets GET seeds it on first open.
 */
export function ProjectSheetView({ projectId, onOpenTask }: { projectId: string; onOpenTask?: (taskId: string) => void }) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [editingCell, setEditingCell] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const refreshList = () => qc.invalidateQueries({ queryKey: ["nexus", "project-sheets", projectId] });
  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = useMutation({
    mutationFn: ({ file, mode }: { file: File; mode: "append" | "replace" }) =>
      nexusApi.importSheet(sheetId as string, file, mode),
    onSuccess: (res) => {
      // Import can create columns, so this is one of the few places a full refetch is right.
      qc.invalidateQueries({ queryKey: key });
      refreshList();
      {
        // Say what was RECOGNISED, not just what was counted — a dropdown or a link surviving the
        // trip is the part someone would otherwise have to go and check by hand.
        const extra = [
          res.dropdowns ? `${res.dropdowns} kolom jadi dropdown` : "",
          res.links ? `${res.links} kolom jadi link` : "",
        ].filter(Boolean).join(", ");
        alert(`${res.imported} baris masuk. Sheet sekarang ${res.columns} kolom${extra ? ` · ${extra}` : ""}.`);
      }
    },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal import."),
  });
  const addSheet = useMutation({
    mutationFn: (name: string) => nexusApi.createSheet(projectId, name),
    onSuccess: (created) => { setActiveId(created.id); refreshList(); },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal bikin sheet."),
  });
  const removeSheet = useMutation({
    mutationFn: (id: string) => nexusApi.deleteSheet(id),
    onSuccess: () => { setActiveId(null); refreshList(); },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal hapus sheet."),
  });

  // Tasks for the "task" column type. Reuses the project's existing task query key, so opening the
  // sheet doesn't fire a second fetch when the board already loaded them.
  const tasksQ = useQuery({
    queryKey: ["nexus", "project-calendar-tasks", projectId],
    queryFn: () => nexusApi.tasks(`projectId=${projectId}`),
    staleTime: 60_000,
  });
  const taskOptions = useMemo(
    () => (tasksQ.data ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status as string | null })),
    [tasksQ.data],
  );

  // Comments for the whole sheet in one call — the grid has to know which cells are flagged before
  // anyone clicks, and a per-cell fetch would be hundreds of requests.
  const [thread, setThread] = useState<{ rowId: string; columnId: string; at: { left: number; top: number } } | null>(null);

  const list = useQuery({
    queryKey: ["nexus", "project-sheets", projectId],
    queryFn: () => nexusApi.projectSheets(projectId),
    staleTime: 60_000,
  });
  const sheets = list.data?.sheets ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  // Fall back to the first sheet whenever the chosen one disappears (deleted elsewhere).
  const sheetId = activeId && sheets.some((s) => s.id === activeId) ? activeId : sheets[0]?.id ?? null;

  const sheetQ = useQuery({
    queryKey: ["nexus", "sheet", sheetId],
    queryFn: () => nexusApi.sheet(sheetId as string),
    enabled: Boolean(sheetId),
    // A refetch landing mid-typing is what unmounts the editing cell, so pause polling while editing.
    refetchInterval: editingCell ? false : 20_000,
    refetchOnWindowFocus: !editingCell,
  });
  const sheet = sheetQ.data;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const commentsQ = useQuery({
    queryKey: ["nexus", "sheet-comments", sheetId],
    queryFn: () => nexusApi.sheetComments(sheetId as string),
    enabled: Boolean(sheetId),
    staleTime: 30_000,
  });
  const comments = commentsQ.data?.comments ?? [];
  const meId = commentsQ.data?.currentUserId ?? null;
  /** Only UNRESOLVED comments raise the corner flag — a closed thread shouldn't nag forever. */
  const commentCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of comments) {
      if (c.resolvedAt) continue;
      const k = `${c.rowId}:${c.columnId}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }, [comments]);
  const threadComments = thread
    ? comments.filter((c) => c.rowId === thread.rowId && c.columnId === thread.columnId)
    : [];
  const refreshComments = () => qc.invalidateQueries({ queryKey: ["nexus", "sheet-comments", sheetId] });

  const setRowHeights = useMutation({
    mutationFn: (heights: { rowId: string; height: number | null }[]) =>
      nexusApi.resizeSheetRows(sheetId as string, heights),
    // Patch rather than invalidate: a refetch mid-typing is what unmounts the editing cell.
    onSuccess: (_res, heights) => {
      qc.setQueryData<NexusSheet>(["nexus", "sheet", sheetId], (prev) => {
        if (!prev) return prev;
        const by = new Map(heights.map((h) => [h.rowId, h.height]));
        return { ...prev, rows: prev.rows.map((r) => (by.has(r.id) ? { ...r, height: by.get(r.id)! } : r)) };
      });
    },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal atur tinggi baris."),
  });
  const resizeRow = (rowId: string, height: number | null) => {
    const before = sheetRef.current?.rows.find((r) => r.id === rowId)?.height ?? null;
    if (before === height) return;
    setRowHeights.mutate([{ rowId, height }]);
    undo.push({
      label: height === null ? "reset tinggi baris" : "atur tinggi baris",
      undo: () => setRowHeights.mutateAsync([{ rowId, height: before }]).then(() => {}),
      redo: () => setRowHeights.mutateAsync([{ rowId, height }]).then(() => {}),
    });
  };

  // --- Live co-editing ------------------------------------------------------
  // The cell open in the editor lives in a REF, not state: the realtime handler only reads it at
  // patch time, and making it state would re-subscribe the socket on every keystroke.
  const editingRef = useRef<{ rowId: string; colId: string } | null>(null);
  const handleEditingChange = useCallback((cell: { rowId: string; colId: string } | null) => {
    editingRef.current = cell;
  }, []);
  const refetchSheet = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["nexus", "sheet", sheetId] });
  }, [qc, sheetId]);
  const { peers, cursors, sendCursor, connected } = useSheetRealtime({
    sheetId: sheetId ?? null,
    meId,
    editingRef,
    onStructureChange: refetchSheet,
  });
  /** Cursors re-keyed by cell, which is how the grid needs to look them up. */
  const peerCells = useMemo(() => {
    const out: Record<string, { name: string; color: string }> = {};
    for (const c of Object.values(cursors)) {
      if (c.rowId && c.columnId) out[`${c.rowId}:${c.columnId}`] = { name: c.name, color: c.color };
    }
    return out;
  }, [cursors]);
  /** Everyone in the room except me — the avatar strip is "who ELSE is here". */
  const otherPeers = peers.filter((p) => p.userId !== meId);

  // History is fetched only while a cell popover is open. Every sheet load pulling every cell's
  // history would be a lot of rows for a panel most people never open.
  const revisionsQ = useQuery({
    queryKey: ["nexus", "sheet-revisions", sheetId, thread?.rowId, thread?.columnId],
    queryFn: () => nexusApi.sheetRevisions(sheetId as string, { rowId: thread!.rowId, columnId: thread!.columnId }),
    enabled: Boolean(sheetId && thread),
    staleTime: 0,
  });

  const addComment = useMutation({
    mutationFn: (body: string) =>
      nexusApi.addSheetComment(sheetId as string, { rowId: thread!.rowId, columnId: thread!.columnId, body }),
    onSuccess: refreshComments,
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal ngirim komentar."),
  });
  const patchComment = useMutation({
    mutationFn: (payload: { commentId: string; resolved?: boolean; body?: string }) =>
      nexusApi.updateSheetComment(sheetId as string, payload),
    onSuccess: refreshComments,
  });
  const dropComment = useMutation({
    mutationFn: (commentId: string) => nexusApi.deleteSheetComment(sheetId as string, commentId),
    onSuccess: refreshComments,
  });

  const key = useMemo(() => ["nexus", "sheet", sheetId] as const, [sheetId]);
  /** Patch only the rows that changed — a blanket invalidate would blow away the editing cell. */
  const patchRows = (rows: NexusSheetRow[]) => {
    qc.setQueryData<NexusSheet>(key, (old) => {
      if (!old) return old;
      const byId = new Map(rows.map((r) => [r.id, r]));
      return { ...old, rows: old.rows.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r)) };
    });
  };

  const undo = useSheetUndo();
  const say = (msg: string) => celebrate(msg);

  const setCells = useMutation({
    mutationFn: (edits: { rowId: string; values: Record<string, unknown> }[]) =>
      nexusApi.setSheetCells(sheetId as string, edits),
    onSuccess: (res) => patchRows(res.rows),
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal nyimpen."),
  });

  /**
   * Apply a cell edit AND record how to reverse it.
   *
   * The previous values are read here, at the moment the caller has them — after the mutation lands
   * they're already gone, and a background refetch could arrive at any time in between.
   */
  const editCells = (edits: { rowId: string; values: Record<string, unknown> }[], label = "edit sel") => {
    const rowsById = new Map(sheetRef.current?.rows.map((r) => [r.id, r]) ?? []);
    const before = edits.map((e) => ({
      rowId: e.rowId,
      values: Object.fromEntries(
        Object.keys(e.values).map((cid) => [cid, rowsById.get(e.rowId)?.cells[cid] ?? null]),
      ),
    }));
    setCells.mutate(edits);
    undo.push({
      label,
      undo: () => setCells.mutateAsync(before).then(() => {}),
      redo: () => setCells.mutateAsync(edits).then(() => {}),
    });
  };

  const addRows = useMutation({
    mutationFn: (payload: { count?: number; afterRowId?: string; beforeRowId?: string; rows?: Record<string, unknown>[]; positions?: number[] }) =>
      nexusApi.addSheetRows(sheetId as string, payload),
    onSuccess: (res) => {
      qc.setQueryData<NexusSheet>(key, (old) => (old ? { ...old, rows: [...old.rows, ...res.rows].sort((a, b) => a.position - b.position) } : old));
    },
  });
  const moveRow = useMutation({
    mutationFn: ({ rowId, afterRowId }: { rowId: string; afterRowId: string | null }) =>
      nexusApi.reorderSheetRow(sheetId as string, rowId, afterRowId),
    // The server computes the midpoint, so the new order only exists once it answers.
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal mindahin baris."),
  });
  const delRows = useMutation({
    mutationFn: (rowIds: string[]) => nexusApi.deleteSheetRows(sheetId as string, rowIds),
    onSuccess: (_r, rowIds) => {
      const gone = new Set(rowIds);
      qc.setQueryData<NexusSheet>(key, (old) => (old ? { ...old, rows: old.rows.filter((r) => !gone.has(r.id)) } : old));
    },
  });

  /** Delete rows, remembering their VALUES AND POSITIONS so undo puts them back where they were. */
  const removeRows = (rowIds: string[]) => {
    const snapshot = (sheetRef.current?.rows ?? []).filter((r) => rowIds.includes(r.id));
    delRows.mutate(rowIds);
    undo.push({
      label: `hapus ${rowIds.length} baris`,
      undo: async () => {
        // The restored rows get NEW ids — a formula that pointed at a deleted row stays #REF!, which
        // is the honest outcome rather than silently re-binding to a different row.
        await addRows.mutateAsync({
          rows: snapshot.map((r) => r.cells as Record<string, unknown>),
          positions: snapshot.map((r) => r.position),
        });
      },
      redo: async () => {
        const current = sheetRef.current?.rows ?? [];
        const again = current.filter((r) => snapshot.some((s) => s.position === r.position)).map((r) => r.id);
        if (again.length) await delRows.mutateAsync(again);
      },
    });
  };
  const saveColumns = useMutation({
    mutationFn: (columns: NexusSheetColumn[]) => nexusApi.updateSheet(sheetId as string, { columns }),
    onSuccess: (res) => qc.setQueryData<NexusSheet>(key, (old) => (old ? { ...old, columns: res.columns } : old)),
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal nyimpen kolom."),
  });

  /**
   * Add a column at `index` (append when index is past the end).
   *
   * Separate from editColumns because undoing an ADD can't just re-send the shorter array: the
   * columns PATCH refuses to drop a column on purpose, so that a column can never disappear without
   * its cell values being wiped too. The inverse of an add is therefore the DELETE route — and the
   * new column's id only exists once the server has answered, so the undo entry is registered after
   * the save rather than before it.
   */
  const addColumnAt = (index: number, label: string) => {
    const before = sheetRef.current?.columns ?? [];
    const next = [...before];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, { name: "", type: "text" } as NexusSheetColumn);
    void saveColumns.mutateAsync(next).then((res) => {
      const created = res.columns.find((c) => !before.some((b) => b.id === c.id));
      if (!created) return;
      undo.push({
        label,
        undo: () => delColumn.mutateAsync(created.id).then(() => {}),
        // The entry in `next` still carries no id, so redoing mints a fresh one. That's fine —
        // nothing references the old id any more, its cells went with it.
        redo: () => saveColumns.mutateAsync(next).then(() => {}),
      });
    });
  };

  /** Any structural column change (rename / retype / resize / reorder) with its inverse. */
  const editColumns = (next: NexusSheetColumn[], label: string) => {
    const before = sheetRef.current?.columns ?? [];
    saveColumns.mutate(next);
    undo.push({
      label,
      undo: () => saveColumns.mutateAsync(before).then(() => {}),
      redo: () => saveColumns.mutateAsync(next).then(() => {}),
    });
  };
  const delColumn = useMutation({
    mutationFn: (columnId: string) => nexusApi.deleteSheetColumn(sheetId as string, columnId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal hapus kolom."),
  });

  /**
   * Delete a column, remembering its definition AND every value in it.
   *
   * Undo can't reuse the old column id (the server mints a fresh one), so it recreates the column and
   * then writes the values back into it by position.
   */
  const removeColumn = (columnId: string) => {
    const cols = sheetRef.current?.columns ?? [];
    const col = cols.find((c) => c.id === columnId);
    if (!col) return;
    const index = cols.indexOf(col);
    const values = (sheetRef.current?.rows ?? [])
      .map((r) => ({ rowId: r.id, value: r.cells[columnId] }))
      .filter((v) => v.value !== undefined);

    delColumn.mutate(columnId);
    undo.push({
      label: `hapus kolom ${col.name || "tanpa nama"}`,
      undo: async () => {
        const now = sheetRef.current?.columns ?? [];
        const restored = [...now];
        restored.splice(Math.min(index, restored.length), 0, { name: col.name, type: col.type, width: col.width } as NexusSheetColumn);
        const saved = await saveColumns.mutateAsync(restored);
        const newId = saved.columns[Math.min(index, saved.columns.length - 1)]?.id;
        if (newId && values.length) {
          await setCells.mutateAsync(values.map((v) => ({ rowId: v.rowId, values: { [newId]: v.value } })));
        }
      },
      redo: async () => {
        const now = sheetRef.current?.columns ?? [];
        const target = now[index];
        if (target) await nexusApi.deleteSheetColumn(sheetId as string, target.id);
        qc.invalidateQueries({ queryKey: key });
      },
    });
  };

  if (list.isLoading || sheetQ.isLoading) {
    return <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sheet) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Spreadsheet-nya belum bisa dibuka.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-black">
          <SheetIcon className="h-4 w-4 text-primary" /> {sheet.name}
        </div>
        <span className="text-xs text-muted-foreground">{sheet.rows.length} baris · {sheet.columns.length} kolom</span>
        {/* Who else has this sheet open. Each ring is that person's cursor colour, so the avatar up
            here and the outlined cell down in the grid read as the same person. */}
        {otherPeers.length > 0 && (
          <div className="flex items-center -space-x-1.5" title={otherPeers.map((p) => p.name).join(", ")}>
            {otherPeers.slice(0, 4).map((p) => (
              <span
                key={p.userId}
                className="rounded-full ring-2"
                style={{ ["--tw-ring-color" as string]: p.color }}
              >
                <Avatar userId={p.userId} name={p.name} avatar={p.avatar} size={20} />
              </span>
            ))}
            {otherPeers.length > 4 && (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[9px] font-black text-muted-foreground ring-2 ring-background">
                +{otherPeers.length - 4}
              </span>
            )}
          </div>
        )}
        {connected && otherPeers.length > 0 && (
          <span className="text-[11px] font-semibold text-emerald-600">live</span>
        )}
        {setCells.isPending && <span className="text-xs text-muted-foreground">nyimpen…</span>}
        {!sheet.canEdit && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">cuma bisa lihat</span>}
        <div className="ml-auto flex items-center gap-1">
          {sheet.canEdit && (
            <>
              <button
                disabled={!undo.canUndo}
                onClick={async () => { const l = await undo.undo(); if (l) say(`Dibatalin: ${l}`); }}
                title="Batalin (Ctrl+Z)"
                className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-30"
              ><Undo2 className="h-3.5 w-3.5" /></button>
              <button
                disabled={!undo.canRedo}
                onClick={async () => { const l = await undo.redo(); if (l) say(`Diulang: ${l}`); }}
                title="Ulangi (Ctrl+Shift+Z)"
                className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-30"
              ><Redo2 className="h-3.5 w-3.5" /></button>
            </>
          )}
          {sheet.canEdit && (
            <>
              <input
                ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // so picking the same file twice still fires
                  if (!file) return;
                  const replace = window.confirm(
                    `Import "${file.name}".\n\nOK = GANTI semua isi sheet ini.\nCancel = TAMBAH di bawah baris yang ada.`,
                  );
                  importFile.mutate({ file, mode: replace ? "replace" : "append" });
                }}
              />
              <button
                disabled={importFile.isPending}
                onClick={() => fileRef.current?.click()}
                title="Import dari CSV atau Excel (.xlsx)"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                {importFile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Import
              </button>
            </>
          )}
          {(["xlsx", "csv"] as const).map((f) => (
            <button
              key={f}
              disabled={exporting !== null}
              onClick={async () => {
                setExporting(f);
                try { await nexusApi.exportSheet(sheet.id, f, `${sheet.name}.${f}`); }
                catch (e) { alert(e instanceof Error ? e.message : "Gagal export."); }
                finally { setExporting(null); }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              {exporting === f ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isMobile ? (
        // A 6-column grid on a phone is unusable, and keyboard nav / paste mean nothing there.
        <MobileCards sheet={sheet} onSet={(rowId, colId, v) => setCells.mutate([{ rowId, values: { [colId]: v } }])} />
      ) : (
        <div
          onFocusCapture={() => setEditingCell(true)}
          onBlurCapture={() => setEditingCell(false)}
          onKeyDown={async (e) => {
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
            // While a cell editor is open, Ctrl+Z belongs to the text field, not the sheet.
            if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
            e.preventDefault();
            const label = e.shiftKey ? await undo.redo() : await undo.undo();
            if (label) say(`${e.shiftKey ? "Diulang" : "Dibatalin"}: ${label}`);
          }}
        >
          <SheetGrid
            columns={sheet.columns}
            rows={sheet.rows}
            canEdit={sheet.canEdit}
            canManage={sheet.canManage}
            onSetCells={(edits) => editCells(edits)}
            onAddRows={async (payload) => {
              const created = (await addRows.mutateAsync(payload)).rows;
              undo.push({
                label: `tambah ${created.length} baris`,
                undo: () => delRows.mutateAsync(created.map((r) => r.id)).then(() => {}),
                redo: () => addRows.mutateAsync({
                  rows: created.map((r) => r.cells as Record<string, unknown>),
                  positions: created.map((r) => r.position),
                }).then(() => {}),
              });
              return created;
            }}
            onDeleteRows={(ids) => removeRows(ids)}
            onReorderRow={(rowId, afterRowId) => moveRow.mutate({ rowId, afterRowId })}
            onDeleteColumn={(columnId) => {
              const col = sheet.columns.find((c) => c.id === columnId);
              // Undo covers this now, so the warning says what's true rather than scaring people off.
              if (window.confirm(`Hapus kolom "${col?.name || "tanpa nama"}"?\n\nSemua isinya ikut hilang, tapi bisa dibalikin pakai Ctrl+Z.`)) {
                removeColumn(columnId);
              }
            }}
            onEditColumn={(columnId, patch) =>
              editColumns(sheet.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)), "ubah kolom")}
            // Blank column straight away — no dialog. Naming and typing it happen in the header
            // (double-click to rename, type picker in the same popover), like a real spreadsheet.
            tasks={taskOptions}
            onOpenTask={onOpenTask}
            commentCounts={commentCounts}
            onOpenComments={(rowId, columnId, at) => setThread({ rowId, columnId, at })}
            peerCursors={peerCells}
            onResizeRow={(rowId, height) => resizeRow(rowId, height)}
            onEditingChange={handleEditingChange}
            onCursor={sendCursor}
            onAddColumn={() => addColumnAt(sheet.columns.length, "tambah kolom")}
            // Splicing works because the server keeps array ORDER and only mints an id for the entry
            // that has none — existing columns keep theirs, so not one cell has to be rewritten, and
            // formulas (stored in id-space) keep pointing at the same data.
            onInsertColumn={(index) => addColumnAt(index, "sisipin kolom")}
          />
        </div>
      )}

      {thread && (
        <CellCommentThread
          anchor={thread.at}
          comments={threadComments}
          meId={meId}
          canEdit={sheet.canEdit}
          busy={addComment.isPending || patchComment.isPending || dropComment.isPending}
          columnType={sheet.columns.find((c) => c.id === thread.columnId)?.type ?? "text"}
          shape={{ columnIds: sheet.columns.map((c) => c.id), rowIds: sheet.rows.map((r) => r.id) }}
          revisions={revisionsQ.data?.revisions ?? []}
          revisionsLoading={revisionsQ.isLoading}
          onAdd={(body) => addComment.mutate(body)}
          onResolve={(commentId, resolved) => patchComment.mutate({ commentId, resolved })}
          onDelete={(commentId) => dropComment.mutate(commentId)}
          onRestore={(value) => {
            // Restoring goes through the SAME cell-write path as typing, so it lands on the undo
            // stack and gets logged as a new revision. History stays append-only; nothing rewinds.
            editCells([{ rowId: thread.rowId, values: { [thread.columnId]: value ?? null } }], "balikin nilai sel");
            setThread(null);
          }}
          onClose={() => setThread(null)}
        />
      )}

      {/* Sheet tabs sit at the BOTTOM because that's where every spreadsheet app puts them. */}
      {(sheets.length > 1 || sheet.canEdit) && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
          {sheets.map((s) => (
            <div key={s.id}
              className={cn("group inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                s.id === sheetId ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
              <button onClick={() => setActiveId(s.id)}>{s.name}</button>
              {/* Slot 0 is the default sheet — the server refuses to delete it, so no button either. */}
              {sheet.canManage && s.position !== 0 && (
                <button
                  onClick={() => {
                    if (window.confirm(`Hapus sheet "${s.name}"? Semua barisnya ikut hilang.`)) removeSheet.mutate(s.id);
                  }}
                  className="hidden text-muted-foreground hover:text-rose-600 group-hover:block"
                  title="Hapus sheet"
                ><X className="h-3 w-3" /></button>
              )}
            </div>
          ))}
          {sheet.canEdit && (
            <button
              disabled={addSheet.isPending}
              onClick={() => {
                const name = window.prompt("Nama sheet baru", `Sheet ${sheets.length + 1}`);
                if (name?.trim()) addSheet.mutate(name.trim());
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            ><Plus className="h-3 w-3" /> Sheet</button>
          )}
        </div>
      )}
    </div>
  );
}

/** Phone view: one card per row, tap a field to edit it. No grid, no keyboard nav — honest instead of cramped. */
function MobileCards({ sheet, onSet }: { sheet: NexusSheet; onSet: (rowId: string, colId: string, value: unknown) => void }) {
  return (
    <div className="space-y-2">
      {sheet.rows.map((row, i) => (
        <div key={row.id} className="rounded-2xl border border-border bg-card p-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Baris {i + 1}</div>
          <div className="space-y-1.5">
            {sheet.columns.map((col) => (
              <label key={col.id} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{col.name}</span>
                {col.type === "checkbox" ? (
                  <input type="checkbox" disabled={!sheet.canEdit} defaultChecked={Boolean(row.cells[col.id])}
                    onChange={(e) => onSet(row.id, col.id, e.target.checked)} className="h-4 w-4 accent-primary" />
                ) : (
                  <input
                    disabled={!sheet.canEdit}
                    type={col.type === "date" ? "date" : "text"}
                    defaultValue={editValue(col.type, row.cells[col.id])}
                    placeholder={formatCell(col.type, row.cells[col.id]) || "—"}
                    onBlur={(e) => {
                      if (e.target.value !== editValue(col.type, row.cells[col.id])) {
                        onSet(row.id, col.id, e.target.value === "" ? null : e.target.value);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
