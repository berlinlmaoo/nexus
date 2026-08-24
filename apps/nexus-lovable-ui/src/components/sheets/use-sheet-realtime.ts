import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import type { NexusSheet, NexusSheetCellValue } from "@/lib/nexus-api";

export type SheetPeer = { userId: string; name: string; avatar: string | null; color: string };
export type PeerCursor = { userId: string; name: string; color: string; rowId: string; columnId: string };

/** A peer cursor goes stale rather than lingering forever if someone's tab dies mid-session. */
const CURSOR_TTL_MS = 45_000;

type IncomingRow = { id: string; cells: Record<string, NexusSheetCellValue>; updatedAt: string };

/**
 * Live co-editing for one sheet: who else is here, where their cursor is, and other people's saves
 * arriving without a refetch.
 *
 * Two rules shape the whole thing:
 *
 * 1. **Cell values come from the SERVER, not from the other browser.** The API route emits what the
 *    database actually accepted; no client can push a value into someone else's grid. Cursors are
 *    the exception — they're ephemeral and worthless to forge, so those relay client-to-client.
 * 2. **Never touch the cell this person has open in the editor.** An incoming patch replacing the
 *    cell you're mid-sentence in is the one failure that would make people stop trusting the
 *    feature, so the currently-edited cell is explicitly carried over from the old row.
 */
export function useSheetRealtime({
  sheetId,
  meId,
  editingRef,
  onStructureChange,
}: {
  sheetId: string | null;
  meId: string | null;
  /** The cell currently open in the editor, or null. Read at patch time, never subscribed to. */
  editingRef: React.MutableRefObject<{ rowId: string; colId: string } | null>;
  onStructureChange: () => void;
}) {
  const qc = useQueryClient();
  const { socket, connected } = useRealtime();
  const [peers, setPeers] = useState<SheetPeer[]>([]);
  const [cursors, setCursors] = useState<Record<string, PeerCursor & { at: number }>>({});

  useRealtimeRoom(sheetId ? `sheet:${sheetId}` : null);

  useEffect(() => {
    if (!socket || !sheetId) return;

    const onPresence = (d: { sheetId: string; members: SheetPeer[] }) => {
      if (d?.sheetId !== sheetId) return;
      setPeers(d.members ?? []);
    };

    const onCursor = (d: PeerCursor & { socketId: string }) => {
      if (!d?.userId || d.userId === meId) return;
      setCursors((prev) => ({ ...prev, [d.userId]: { ...d, at: Date.now() } }));
    };

    const onCells = (d: { rows: IncomingRow[]; actorId: string }) => {
      // My own write already patched the cache optimistically; re-applying the echo would just make
      // the grid flash.
      if (!d?.rows?.length || d.actorId === meId) return;
      const incoming = new Map(d.rows.map((r) => [r.id, r]));
      qc.setQueryData<NexusSheet>(["nexus", "sheet", sheetId], (prev) => {
        if (!prev) return prev;
        const editing = editingRef.current;
        return {
          ...prev,
          rows: prev.rows.map((row) => {
            const inc = incoming.get(row.id);
            if (!inc) return row;
            if (editing && editing.rowId === row.id) {
              // Take everything they changed EXCEPT the cell under this person's cursor.
              const cells = { ...inc.cells };
              if (editing.colId in row.cells) cells[editing.colId] = row.cells[editing.colId];
              else delete cells[editing.colId];
              return { ...row, cells, updatedAt: inc.updatedAt };
            }
            return { ...row, cells: inc.cells, updatedAt: inc.updatedAt };
          }),
        };
      });
    };

    // Rows added/removed/reordered or columns changed: the shape moved, so a surgical patch can't
    // express it. Refetching is correct here and safe — it only happens on structural edits, which
    // nobody is doing while someone types.
    const onStructure = (d: { actorId: string }) => {
      if (d?.actorId === meId) return;
      onStructureChange();
    };

    socket.on("sheet-presence", onPresence);
    socket.on("sheet-cursor", onCursor);
    socket.on("sheet-cells", onCells);
    socket.on("sheet-structure", onStructure);
    return () => {
      socket.off("sheet-presence", onPresence);
      socket.off("sheet-cursor", onCursor);
      socket.off("sheet-cells", onCells);
      socket.off("sheet-structure", onStructure);
    };
  }, [socket, sheetId, meId, qc, editingRef, onStructureChange]);

  // Drop cursors nobody has refreshed. Without this a closed tab leaves a ghost parked on a cell.
  useEffect(() => {
    const t = setInterval(() => {
      setCursors((prev) => {
        const cutoff = Date.now() - CURSOR_TTL_MS;
        const live = Object.fromEntries(Object.entries(prev).filter(([, c]) => c.at > cutoff));
        return Object.keys(live).length === Object.keys(prev).length ? prev : live;
      });
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  // Peers leaving takes their cursor with them, so a stale marker can't outlive the session.
  useEffect(() => {
    const here = new Set(peers.map((p) => p.userId));
    setCursors((prev) => {
      const live = Object.fromEntries(Object.entries(prev).filter(([uid]) => here.has(uid)));
      return Object.keys(live).length === Object.keys(prev).length ? prev : live;
    });
  }, [peers]);

  const last = useRef("");
  const sendCursor = useCallback(
    (rowId: string | null, columnId: string | null) => {
      if (!socket || !sheetId || !connected) return;
      const key = `${rowId}:${columnId}`;
      if (key === last.current) return; // arrow-key runs would otherwise emit on every repeat
      last.current = key;
      socket.emit("sheet-cursor", { sheetId, rowId, columnId });
    },
    [socket, sheetId, connected],
  );

  return { peers, cursors, sendCursor, connected };
}
