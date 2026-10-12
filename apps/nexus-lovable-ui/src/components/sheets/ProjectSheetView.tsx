import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Sheet as SheetIcon, Upload } from "lucide-react";
import {
  nexusApi, type NexusSheet, type NexusSheetCellStyle, type NexusSheetColumn, type NexusSheetColumnColor, type NexusSheetRow,
  type NexusSheetSettings,
} from "@/lib/nexus-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { celebrate } from "@/components/Celebration";
import { Avatar } from "@/components/Avatar";
import { CellCommentThread } from "./CellComments";
import { useSheetRealtime } from "./use-sheet-realtime";
import { SheetGrid } from "./SheetGrid";
import { SheetMobile } from "./SheetMobile";
import { SheetTabs } from "./SheetTabs";
import { useSheetUndo } from "./use-sheet-undo";
import { useLang } from "@/lib/lang";
import { PivotEditor } from "./PivotEditor";
import { computePivot, distinctFieldValues, pivotFields, pivotSuggestions } from "@/lib/sheet-pivot";
import { buildSheetData, displayCell } from "./sheet-types";
import { engineFor } from "@/lib/sheet-formula";
import { rangeFromA1, rangeRect, rangeToA1 } from "@/lib/sheet-validation";
import type { PivotSpec } from "@/lib/sheet-model";
import { useSubmitGuard } from "@/hooks/use-submit-guard";

type SettingsPatch = { [K in keyof NexusSheetSettings]?: NexusSheetSettings[K] | null };

/**
 * The Spreadsheet tab. Free-form rows that belong to nothing — unlike the Table view, whose rows are
 * always tasks. Every project gets one automatically; the sheets GET seeds it on first open.
 */
export function ProjectSheetView({ projectId, onOpenTask }: { projectId: string; onOpenTask?: (taskId: string) => void }) {
  const qc = useQueryClient();
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [editingCell, setEditingCell] = useState(false);
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
          res.dropdowns ? t("{n} columns became dropdowns", { n: res.dropdowns }) : "",
          res.links ? t("{n} columns became links", { n: res.links }) : "",
        ].filter(Boolean).join(", ");
        alert(t("{rows} rows imported. The sheet now has {cols} columns.", { rows: res.imported, cols: res.columns }) + (extra ? ` ${extra}.` : ""));
      }
    },
    onError: (e) => alert(e instanceof Error ? e.message : t("Import failed.")),
  });
  const addSheet = useMutation({
    mutationFn: (name: string) => nexusApi.createSheet(projectId, name),
    onSuccess: (created) => { setActiveId(created.id); refreshList(); },
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't create the sheet.")),
  });
  // Double-click "Add sheet" made two calls (one 500) and repeated names (bughunt S-BUG-17): one call in flight,
  // and the first free "Sheet N".
  const [guardAddSheet] = useSubmitGuard();
  const newSheet = () => guardAddSheet(() => {
    const taken = new Set(sheets.map((x) => x.name.trim().toLowerCase()));
    let n = sheets.length + 1;
    while (taken.has(`sheet ${n}`) || taken.has(`sheet${n}`)) n++;
    return addSheet.mutateAsync(`Sheet ${n}`);
  });
  const removeSheet = useMutation({
    mutationFn: (id: string) => nexusApi.deleteSheet(id),
    onSuccess: () => { setActiveId(null); refreshList(); },
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't delete the sheet.")),
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
  /** A one-shot instruction for the grid from outside it (tab menu › Protect sheet / View comments). */
  const [gridCommand, setGridCommand] = useState<{ kind: "protectSheet" | "comments"; n: number } | null>(null);
  const membersQ = useQuery({
    queryKey: ["nexus", "project-members-lite", projectId],
    queryFn: () => nexusApi.projectMembers(projectId),
    staleTime: 300_000,
  });
  const members = useMemo(() => {
    const raw = membersQ.data;
    const arr = Array.isArray(raw) ? raw : raw?.members ?? [];
    return arr.map((m) => ({ id: m.userId ?? m.user?.id ?? "", name: m.user?.name ?? m.user?.email ?? "" })).filter((m) => m.id);
  }, [membersQ.data]);
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
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't change the row height.")),
  });
  const resizeRow = (rowId: string, height: number | null) => {
    const before = sheetRef.current?.rows.find((r) => r.id === rowId)?.height ?? null;
    if (before === height) return;
    setRowHeights.mutate([{ rowId, height }]);
    undo.push({
      label: height === null ? t("reset row height") : t("row height"),
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
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't send the comment.")),
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
  /**
   * Patch only the rows that changed — a blanket invalidate would blow away the editing cell.
   *
   * A row is only replaced by a version at least as NEW as the one on screen: a slow response to my
   * own save can arrive after a colleague's later edit (pushed over realtime), and must not put the
   * older row back on top of it.
   */
  const patchRows = (rows: { id: string; cells: NexusSheetRow["cells"]; updatedAt: string }[]) => {
    qc.setQueryData<NexusSheet>(key, (old) => {
      if (!old) return old;
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        ...old,
        rows: old.rows.map((r) => {
          const inc = byId.get(r.id);
          if (!inc) return r;
          if (Date.parse(inc.updatedAt) < Date.parse(r.updatedAt)) return r;
          return { ...r, ...inc };
        }),
      };
    });
  };

  const undo = useSheetUndo();
  const say = (msg: string) => celebrate(msg);

  // --- Saving cells -----------------------------------------------------------
  // Edits land on screen at once (optimistic) and are sent in ONE request per burst: everything
  // queued within ~120 ms (a fill, a paste, quick typing across cells, undo) is merged per row.
  // The server answer then replaces the optimistic rows — unless something newer arrived meanwhile.
  type Edit = { rowId: string; values: Record<string, unknown> };
  const pending = useRef(new Map<string, Record<string, unknown>>());
  const waiters = useRef<{ resolve: () => void; reject: (e: unknown) => void }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(0);
  const flush = useCallback(async () => {
    timer.current = null;
    const id = sheetRef.current?.id;
    const batch = [...pending.current.entries()].map(([rowId, values]) => ({ rowId, values }));
    const done = waiters.current;
    pending.current = new Map();
    waiters.current = [];
    if (!id || !batch.length) { done.forEach((w) => w.resolve()); return; }
    setSaving((n) => n + 1);
    try {
      const res = await nexusApi.setSheetCells(id, batch);
      patchRows(res.rows);
      done.forEach((w) => w.resolve());
    } catch (e) {
      alert(e instanceof Error ? e.message : t("Couldn't save."));
      // The optimistic values may be wrong now — take the server's truth.
      qc.invalidateQueries({ queryKey: ["nexus", "sheet", id] });
      done.forEach((w) => w.reject(e));
    } finally {
      setSaving((n) => n - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);
  // Leaving the sheet must not drop a queued edit.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [sheetId, flush]);
  const queueCells = (edits: Edit[]): Promise<void> => {
    if (!edits.length) return Promise.resolve();
    qc.setQueryData<NexusSheet>(key, (old) => {
      if (!old) return old;
      const byId = new Map(edits.map((e) => [e.rowId, e.values]));
      return {
        ...old,
        rows: old.rows.map((r) => {
          const values = byId.get(r.id);
          if (!values) return r;
          const cells = { ...r.cells } as Record<string, unknown>;
          for (const [k, v] of Object.entries(values)) { if (v === null || v === undefined || v === "") delete cells[k]; else cells[k] = v; }
          return { ...r, cells: cells as NexusSheetRow["cells"] };
        }),
      };
    });
    for (const e of edits) pending.current.set(e.rowId, { ...(pending.current.get(e.rowId) ?? {}), ...e.values });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 120);
    return new Promise<void>((resolve, reject) => waiters.current.push({ resolve, reject }));
  };
  const setCells = {
    mutate: (edits: Edit[]) => { queueCells(edits).catch(() => {}); },
    mutateAsync: (edits: Edit[]) => queueCells(edits),
    isPending: saving > 0,
  };

  /**
   * Apply a cell edit AND record how to reverse it.
   *
   * The previous values are read here, at the moment the caller has them — after the mutation lands
   * they're already gone, and a background refetch could arrive at any time in between.
   */
  const editCells = (edits: { rowId: string; values: Record<string, unknown> }[], label = t("edit cells")) => {
    // From the cache, not the last render: two quick edits must each see the other's value as "before".
    const current = qc.getQueryData<NexusSheet>(key)?.rows ?? sheetRef.current?.rows ?? [];
    const rowsById = new Map(current.map((r) => [r.id, r]));
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
    mutationFn: (payload: { count?: number; afterRowId?: string; beforeRowId?: string; rows?: Record<string, unknown>[]; positions?: number[]; styles?: Record<string, unknown>[] }) =>
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
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't move the row.")),
  });
  const delRows = useMutation({
    mutationFn: (rowIds: string[]) => nexusApi.deleteSheetRows(sheetId as string, rowIds),
    onSuccess: (res, rowIds) => {
      const gone = new Set(rowIds);
      qc.setQueryData<NexusSheet>(key, (old) => (old ? { ...old, rows: old.rows.filter((r) => !gone.has(r.id)) } : old));
      // Formulas whose range lost a corner row were shrunk by the server; show the new versions.
      const rewritten = (res as { rows?: { id: string; cells: NexusSheetRow["cells"]; updatedAt: string }[] }).rows;
      if (rewritten?.length) patchRows(rewritten);
    },
  });

  /** Move a row, remembering the row it used to follow so the move can be undone. */
  const reorderRow = (rowId: string, afterRowId: string | null) => {
    const list = sheetRef.current?.rows ?? [];
    const i = list.findIndex((r) => r.id === rowId);
    if (i < 0) return;
    const before = i > 0 ? list[i - 1].id : null;
    moveRow.mutate({ rowId, afterRowId });
    undo.push({
      label: t("move row"),
      undo: () => moveRow.mutateAsync({ rowId, afterRowId: before }).then(() => {}),
      redo: () => moveRow.mutateAsync({ rowId, afterRowId }).then(() => {}),
    });
  };

  /** Delete rows, remembering their VALUES AND POSITIONS so undo puts them back where they were. */
  const removeRows = (rowIds: string[]) => {
    const snapshot = (sheetRef.current?.rows ?? []).filter((r) => rowIds.includes(r.id));
    delRows.mutate(rowIds);
    undo.push({
      label: t("delete {n} rows", { n: rowIds.length }),
      undo: async () => {
        // The restored rows get NEW ids — a formula that pointed at a deleted row stays #REF!, which
        // is the honest outcome rather than silently re-binding to a different row.
        await addRows.mutateAsync({
          rows: snapshot.map((r) => r.cells as Record<string, unknown>),
          positions: snapshot.map((r) => r.position),
          // Formatting comes back with the values.
          styles: snapshot.map((r) => (r.styles ?? {}) as Record<string, unknown>),
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
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't save the column.")),
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
  const addColumnAt = (index: number, label: string, count = 1) => {
    const before = sheetRef.current?.columns ?? [];
    const next = [...before];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, ...Array.from({ length: Math.max(1, count) }, () => ({ name: "", type: "text" } as NexusSheetColumn)));
    void saveColumns.mutateAsync(next).then((res) => {
      const created = res.columns.filter((c) => !before.some((b) => b.id === c.id));
      if (!created.length) return;
      undo.push({
        label,
        undo: async () => { for (const c of created) await delColumn.mutateAsync(c.id); },
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
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn't delete the column.")),
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
      label: t("delete column {name}", { name: col.name || t("(untitled)") }),
      undo: async () => {
        const now = sheetRef.current?.columns ?? [];
        const restored = [...now];
        // The WHOLE definition comes back — choices, chip colours, header colour, rules — only the id
        // is new (the server mints it).
        const { id: _oldId, ...definition } = col;
        restored.splice(Math.min(index, restored.length), 0, definition as NexusSheetColumn);
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

  // --- Formatting -------------------------------------------------------------
  /** Apply per-cell formatting at once (optimistic) and save it; the server answer then wins. */
  const sendStyles = async (edits: { rowId: string; values: Record<string, NexusSheetCellStyle | null> }[]) => {
    const id = sheetRef.current?.id;
    if (!id || !edits.length) return;
    qc.setQueryData<NexusSheet>(key, (old) => {
      if (!old) return old;
      const byId = new Map(edits.map((e) => [e.rowId, e.values]));
      return {
        ...old,
        rows: old.rows.map((r) => {
          const values = byId.get(r.id);
          if (!values) return r;
          const styles = { ...(r.styles ?? {}) };
          for (const [k, v] of Object.entries(values)) { if (v) styles[k] = v; else delete styles[k]; }
          return { ...r, styles };
        }),
      };
    });
    setSaving((n) => n + 1);
    try {
      for (let i = 0; i < edits.length; i += 500) {
        const res = await nexusApi.setSheetStyles(id, edits.slice(i, i + 500));
        patchRows(res.rows);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : t("Couldn't save."));
      qc.invalidateQueries({ queryKey: ["nexus", "sheet", id] });
    } finally {
      setSaving((n) => n - 1);
    }
  };
  const editStyles = (edits: { rowId: string; values: Record<string, NexusSheetCellStyle | null> }[], label: string) => {
    const current = qc.getQueryData<NexusSheet>(key)?.rows ?? [];
    const rowsById = new Map(current.map((r) => [r.id, r]));
    const before = edits.map((e) => ({
      rowId: e.rowId,
      values: Object.fromEntries(Object.keys(e.values).map((cid) => [cid, rowsById.get(e.rowId)?.styles?.[cid] ?? null])),
    }));
    void sendStyles(edits);
    undo.push({ label, undo: () => sendStyles(before), redo: () => sendStyles(edits) });
  };

  // --- Sheet settings (freeze, hide, merge, tab colour) ---------------------------
  const sendSettings = async (patch: SettingsPatch, id = sheetRef.current?.id) => {
    if (!id) return;
    if (id === sheetRef.current?.id) {
      qc.setQueryData<NexusSheet>(["nexus", "sheet", id], (old) => {
        if (!old) return old;
        const next: Record<string, unknown> = { ...(old.settings ?? {}) };
        for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete next[k]; else next[k] = v; }
        return { ...old, settings: next as NexusSheetSettings };
      });
    }
    try {
      const res = await nexusApi.updateSheet(id, { settings: patch });
      qc.setQueryData<NexusSheet>(["nexus", "sheet", id], (old) => (old ? { ...old, settings: res.settings } : old));
    } catch (e) {
      alert(e instanceof Error ? e.message : t("Couldn't save."));
      qc.invalidateQueries({ queryKey: ["nexus", "sheet", id] });
    }
  };
  const editSettings = (patch: SettingsPatch, label: string) => {
    const cur = (sheetRef.current?.settings ?? {}) as Record<string, unknown>;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, cur[k] ?? null])) as SettingsPatch;
    void sendSettings(patch);
    undo.push({ label, undo: () => sendSettings(before), redo: () => sendSettings(patch) });
  };

  // --- Tabs ---------------------------------------------------------------------
  const renameSheet = async (id: string, name: string) => {
    try {
      await nexusApi.updateSheet(id, { name });
      qc.setQueryData<NexusSheet>(["nexus", "sheet", id], (old) => (old ? { ...old, name } : old));
      refreshList();
    } catch (e) { alert(e instanceof Error ? e.message : t("Couldn't save.")); }
  };
  const duplicateSheet = async (id: string) => {
    try {
      const created = await nexusApi.duplicateSheet(projectId, id);
      setActiveId(created.id);
      refreshList();
    } catch (e) { alert(e instanceof Error ? e.message : t("Couldn't duplicate the sheet.")); }
  };
  const hideSheet = async (id: string, hidden: boolean) => {
    await sendSettings({ hidden: hidden ? true : null }, id);
    refreshList();
    if (hidden && id === sheetId) setActiveId(sheets.find((s) => s.id !== id && !s.hidden)?.id ?? null);
  };
  /** Data › Sort sheet: rows trade places for real, with the old order kept for undo. */
  const reorderRows = async (order: string[], before: string[], label: string) => {
    const id = sheetRef.current?.id;
    if (!id) return;
    const apply = async (o: string[]) => {
      // On screen at once: the listed rows take the positions they already hold, in the new order.
      qc.setQueryData<NexusSheet>(["nexus", "sheet", id], (old) => {
        if (!old) return old;
        const listed = new Set(o);
        const slots = old.rows.filter((r) => listed.has(r.id)).map((r) => r.position).sort((a, b) => a - b);
        const pos = new Map(o.map((rid, i) => [rid, slots[i]]));
        return { ...old, rows: old.rows.map((r) => (pos.has(r.id) ? { ...r, position: pos.get(r.id)! } : r)).sort((a, b) => a.position - b.position) };
      });
      try { await nexusApi.reorderSheetRows(id, o); } catch (e) { alert(e instanceof Error ? e.message : t("Couldn't save.")); qc.invalidateQueries({ queryKey: ["nexus", "sheet", id] }); }
    };
    await apply(order);
    undo.push({ label, undo: () => apply(before), redo: () => apply(order) });
  };
  /** Insert › Pivot table › New sheet: "Pivot Table N", fed by `range` of the source sheet. */
  const createPivot = async (sourceId: string, range: string) => {
    try {
      const used = new Set(sheets.map((s) => s.name));
      let n = 1; while (used.has(`Pivot Table ${n}`)) n += 1;
      const created = await nexusApi.createSheet(projectId, `Pivot Table ${n}`);
      await nexusApi.updateSheet(created.id, { settings: { pivot: { source: sourceId, range, rows: [], cols: [], values: [], filters: [] } } });
      setActiveId(created.id);
      refreshList();
    } catch (e) { alert(e instanceof Error ? e.message : t("Couldn't create the sheet.")); }
  };
  /** File › Settings: locale, time zone and calculation are the spreadsheet's (every tab of the project). */
  const saveSpreadsheetSettings = async (patch: SettingsPatch) => {
    const before = (sheetRef.current?.settings ?? {}) as Record<string, unknown>;
    const undoPatch = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])) as SettingsPatch;
    const apply = async (p: SettingsPatch) => { for (const s of sheets) await sendSettings(p, s.id); };
    await apply(patch);
    undo.push({ label: t("settings"), undo: () => apply(undoPatch), redo: () => apply(patch) });
  };
  const colorSheet = async (id: string, color: string | null) => {
    await sendSettings({ tabColor: color }, id);
    refreshList();
  };
  const moveSheet = async (id: string, dir: -1 | 1) => {
    const order = sheets.map((s) => s.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try { await nexusApi.reorderSheets(projectId, order); refreshList(); }
    catch (e) { alert(e instanceof Error ? e.message : t("Couldn't move the sheet.")); }
  };

  // --- Pivot sheets ("Pivot Table N") ------------------------------------------------------------
  // The pivot is computed from its source sheet in the browser and WRITTEN into the pivot sheet's
  // cells, so the phones (GET ?computed=1) and exports show it too. Re-written whenever the source or
  // the pivot's definition changes; the cells are derived data, so they skip the undo stack.
  const pivot = sheet?.settings?.pivot ?? null;
  const pivotSrcQ = useQuery({
    queryKey: ["nexus", "sheet", pivot?.source],
    queryFn: () => nexusApi.sheet(pivot!.source),
    enabled: Boolean(pivot?.source),
    staleTime: 20_000,
  });
  const pivotSrc = useMemo(() => {
    const src = pivotSrcQ.data;
    if (!src) return null;
    const data = buildSheetData(src.columns, src.rows);
    const engine = engineFor(data);
    const headRow = (() => { const rc = pivot ? rangeRect(pivot.range, data.shape) : null; return rc ? src.rows[rc.top] : null; })();
    const headerOf = (colId: string) => {
      const col = src.columns.find((c) => c.id === colId);
      const text = col && headRow ? displayCell(col.type, headRow.cells[colId], { data, rowId: headRow.id, colId }) : "";
      return text || col?.name || colId;
    };
    return { sheet: src, data, engine, headerOf };
  }, [pivotSrcQ.data, pivot]);
  const pivotResult = useMemo(() => (pivot && pivotSrc ? computePivot(pivot, pivotSrc) : null), [pivot, pivotSrc]);
  const pivotWriting = useRef(false);
  useEffect(() => {
    const cur = sheetRef.current;
    if (!pivotResult || !cur || !cur.canEdit || pivotWriting.current) return;
    // Labels the pivot makes ("Grand Total", "SUM of Jumlah", "Apel Total") in the interface language.
    const tr = (v: unknown) => {
      if (typeof v !== "string") return v;
      if (v === "Grand Total") return t("Grand Total");
      const m = /^([A-Z]+) of (.+)$/.exec(v);
      if (m) return t("{fn} of {name}", { fn: m[1], name: m[2] });
      const tot = /^(.+) Total$/.exec(v);
      if (tot) return t("{name} Total", { name: tot[1] });
      return v;
    };
    const grid = pivotResult.grid.map((r) => r.map((v) => tr(v) as typeof v));
    const width = Math.max(1, ...grid.map((r) => r.length));
    const textOf = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    // Already up to date? Compare what is stored with what the pivot produces.
    const same = grid.length <= cur.rows.length && width <= cur.columns.length
      && cur.rows.every((row, i) => cur.columns.every((col, j) => textOf((grid[i] ?? [])[j] ?? null) === textOf(row.cells[col.id] ?? null)));
    if (same) return;
    pivotWriting.current = true;
    (async () => {
      try {
        let cols = cur.columns, rowsNow = cur.rows;
        if (width > cols.length) {
          const next = [...cols, ...Array.from({ length: width - cols.length }, () => ({ name: "", type: "text" } as NexusSheetColumn))];
          cols = (await nexusApi.updateSheet(cur.id, { columns: next })).columns;
        }
        if (grid.length > rowsNow.length) rowsNow = [...rowsNow, ...(await nexusApi.addSheetRows(cur.id, { count: grid.length - rowsNow.length })).rows];
        const edits = rowsNow.map((row, i) => ({
          rowId: row.id,
          values: Object.fromEntries(cols.map((col, j) => [col.id, (grid[i] ?? [])[j] ?? null])),
        })).filter((e) => Object.entries(e.values).some(([k, v]) => textOf(v) !== textOf(rowsNow.find((r) => r.id === e.rowId)?.cells[k] ?? null)));
        if (edits.length) await nexusApi.setSheetCells(cur.id, edits);
        // Percent cells read as percent; everything else as numbers with grouping.
        const styleEdits = rowsNow.slice(0, grid.length).map((row, i) => ({
          rowId: row.id,
          values: Object.fromEntries(cols.slice(0, width).map((col, j) => {
            const f = pivotResult.formats[i]?.[j];
            return [col.id, i === 0 || (grid[i]?.[0] ?? "") === t("Grand Total") ? { b: 1 as const, ...(f === "pct" ? { nf: "pct" as const } : {}) } : f === "pct" ? { nf: "pct" as const } : null];
          })),
        }));
        await nexusApi.setSheetStyles(cur.id, styleEdits);
        qc.invalidateQueries({ queryKey: ["nexus", "sheet", cur.id] });
      } catch (e) {
        console.error("[sheets] pivot refresh failed", e);
      } finally {
        pivotWriting.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pivotResult]);
  const [pivotEditorOpen, setPivotEditorOpen] = useState(true);
  const savePivot = (next: PivotSpec) => { void sendSettings({ pivot: next }); };

  if (list.isLoading || sheetQ.isLoading) {
    return <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sheet) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{t("This spreadsheet can't be opened yet.")}</p>;
  }

  const tabs = (
    <SheetTabs
      sheets={sheets}
      activeId={sheetId}
      canEdit={sheet.canEdit}
      canManage={sheet.canManage}
      onSelect={(id) => setActiveId(id)}
      onAdd={() => newSheet()}
      onRename={(id, name) => void renameSheet(id, name)}
      onDuplicate={(id) => void duplicateSheet(id)}
      onDelete={(id) => {
        const s = sheets.find((x) => x.id === id);
        if (window.confirm(t("Delete sheet \"{name}\"? All of its rows go too (it can be restored from Audit).", { name: s?.name ?? "" }))) removeSheet.mutate(id);
      }}
      onColor={(id, c) => void colorSheet(id, c)}
      onMove={(id, dir) => void moveSheet(id, dir)}
      onHide={(id, hidden) => void hideSheet(id, hidden)}
      onProtect={(id) => { setActiveId(id); setGridCommand({ kind: "protectSheet", n: Date.now() }); }}
      onComments={(id) => { setActiveId(id); setGridCommand({ kind: "comments", n: Date.now() }); }}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <SheetIcon className="h-4 w-4 shrink-0 text-muted-foreground" /> <span className="truncate">{sheet.name}</span>
        </div>
        {/* Who else has this sheet open. Each ring is that person's cursor colour. */}
        {otherPeers.length > 0 && (
          <div className="flex items-center -space-x-1.5" title={otherPeers.map((p) => p.name).join(", ")}>
            {otherPeers.slice(0, 4).map((p) => (
              <span key={p.userId} className="rounded-full ring-2" style={{ ["--tw-ring-color" as string]: p.color }}>
                <Avatar userId={p.userId} name={p.name} avatar={p.avatar} size={20} />
              </span>
            ))}
            {otherPeers.length > 4 && (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-2 ring-background">
                +{otherPeers.length - 4}
              </span>
            )}
          </div>
        )}
        {connected && otherPeers.length > 0 && <span className="text-2xs font-medium text-success">{t("live")}</span>}
        {!sheet.canEdit && <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">{t("view only")}</span>}
        {sheet.canEdit && !isMobile && (
          <span className="text-2xs text-muted-foreground" aria-live="polite">{setCells.isPending || saving > 0 ? t("Saving…") : t("All changes saved")}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {sheet.canEdit && (
            <>
              <input
                ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // so picking the same file twice still fires
                  if (!file) return;
                  const replace = window.confirm(t("Import \"{file}\".\n\nOK = REPLACE everything in this sheet.\nCancel = ADD below the existing rows.", { file: file.name }));
                  importFile.mutate({ file, mode: replace ? "replace" : "append" });
                }}
              />
              {importFile.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </>
          )}
        </div>
      </div>

      {isMobile ? (
        <SheetMobile
          sheet={sheet}
          onSetCells={(edits) => editCells(edits)}
          footer={tabs}
          saving={setCells.isPending}
        />
      ) : (
        <div
          onFocusCapture={() => setEditingCell(true)}
          onBlurCapture={() => setEditingCell(false)}
          onKeyDown={async (e) => {
            const k = e.key.toLowerCase();
            // Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo.
            if (!(e.metaKey || e.ctrlKey) || (k !== "z" && k !== "y")) return;
            // While a cell editor is open, Ctrl+Z belongs to the text field, not the sheet.
            if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
            e.preventDefault();
            const redo = k === "y" || e.shiftKey;
            const label = redo ? await undo.redo() : await undo.undo();
            if (label) say(redo ? t("Redone: {what}", { what: label }) : t("Undone: {what}", { what: label }));
          }}
        >
          <SheetGrid
            columns={sheet.columns}
            rows={sheet.rows}
            settings={sheet.settings ?? {}}
            canEdit={sheet.canEdit}
            canManage={sheet.canManage}
            onSetCells={(edits) => editCells(edits)}
            onSetStyles={editStyles}
            onSettings={editSettings}
            onAddRows={async (payload) => {
              const created = (await addRows.mutateAsync(payload)).rows;
              undo.push({
                label: t("add {n} rows", { n: created.length }),
                undo: () => delRows.mutateAsync(created.map((r) => r.id)).then(() => {}),
                redo: () => addRows.mutateAsync({
                  rows: created.map((r) => r.cells as Record<string, unknown>),
                  positions: created.map((r) => r.position),
                }).then(() => {}),
              });
              return created;
            }}
            onDeleteRows={(ids) => removeRows(ids)}
            onReorderRow={(rowId, afterRowId) => reorderRow(rowId, afterRowId)}
            onDeleteColumn={(columnId) => {
              const col = sheet.columns.find((c) => c.id === columnId);
              if (window.confirm(t("Delete column \"{name}\"?\n\nEverything in it goes too, but Ctrl+Z brings it back.", { name: col?.name || t("(untitled)") }))) {
                removeColumn(columnId);
              }
            }}
            onEditColumn={(columnId, patch) =>
              editColumns(sheet.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)), t("edit column"))}
            tasks={taskOptions}
            onOpenTask={onOpenTask}
            commentCounts={commentCounts}
            onOpenComments={(rowId, columnId, at) => setThread({ rowId, columnId, at })}
            peerCursors={peerCells}
            onResizeRow={(rowId, height) => resizeRow(rowId, height)}
            onEditingChange={handleEditingChange}
            onCursor={sendCursor}
            onAddColumn={() => addColumnAt(sheet.columns.length, t("add column"))}
            // Splicing works because the server keeps array ORDER and only mints an id for the entry
            // that has none — existing columns keep theirs, so not one cell has to be rewritten.
            onInsertColumn={(index, count) => addColumnAt(index, t("insert column"), count ?? 1)}
            command={gridCommand}
            host={{
              sheetId: sheet.id,
              sheets,
              meId,
              members,
              importFile: () => fileRef.current?.click(),
              download: (f) => { void nexusApi.exportSheet(sheet.id, f, `${sheet.name}.${f}`).catch((e) => alert(e instanceof Error ? e.message : t("Export failed."))); },
              renameSheet: () => { const name = window.prompt(t("Rename"), sheet.name); if (name?.trim()) void renameSheet(sheet.id, name.trim()); },
              insertSheet: () => newSheet(),
              setSheetHidden: (id, hidden) => void hideSheet(id, hidden),
              reorderRows,
              reorderColumns: (ids) => editColumns(ids.map((cid) => sheet.columns.find((c) => c.id === cid)!).filter(Boolean), t("move columns")),
              createPivot: (range) => void createPivot(sheet.id, range),
              saveSpreadsheetSettings: (patch) => void saveSpreadsheetSettings(patch as SettingsPatch),
              deleteColumns: (ids) => {
                if (!window.confirm(t("Delete {n} columns?\n\nEverything in them goes too, but Ctrl+Z brings each back.", { n: ids.length }))) return;
                ids.forEach((id) => removeColumn(id));
              },
            }}
            canUndo={undo.canUndo}
            canRedo={undo.canRedo}
            onUndo={async () => { const l = await undo.undo(); if (l) say(t("Undone: {what}", { what: l })); }}
            onRedo={async () => { const l = await undo.redo(); if (l) say(t("Redone: {what}", { what: l })); }}
            footerLeft={tabs}
            aside={pivot && pivotSrc && pivotEditorOpen ? (
              <PivotEditor
                spec={pivot}
                sourceSheetName={pivotSrc.sheet.name}
                rangeA1={rangeToA1(pivot.range, pivotSrc.data.shape)}
                fields={pivotFields(pivotSrc, pivot.range)}
                valuesFor={(colId) => distinctFieldValues(pivotSrc, pivot.range, colId)}
                suggestions={pivotSuggestions(pivotSrc, pivot.range)}
                canEdit={sheet.canEdit}
                onChange={savePivot}
                onRangeChange={(a1) => { const r = rangeFromA1(a1, pivotSrc.data.shape); if (!r) return false; savePivot({ ...pivot, range: r }); return true; }}
                onClose={() => setPivotEditorOpen(false)}
              />
            ) : null}
            onReopenAside={pivot ? () => setPivotEditorOpen(true) : undefined}
            saving={setCells.isPending}
            sheetName={sheet.name}
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
            // stack and gets logged as a new revision. History stays append-only.
            editCells([{ rowId: thread.rowId, values: { [thread.columnId]: value ?? null } }], t("restore cell value"));
            setThread(null);
          }}
          onClose={() => setThread(null)}
        />
      )}
    </div>
  );
}
