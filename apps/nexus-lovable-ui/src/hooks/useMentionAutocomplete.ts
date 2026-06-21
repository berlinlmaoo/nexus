import { useEffect, useMemo, useRef, useState } from "react";

export type MentionUser = { id: string; name?: string | null; email?: string | null; avatar?: string | null };

/**
 * Shared @-mention autocomplete for textareas (feed posts/comments + task comments).
 * Tracks the EXACT userIds picked so the backend notifies the right person regardless of display name.
 *
 * - Pass `onSubmit` to enable Enter-to-submit (used by single-line comment inputs).
 *   Omit it for multi-line composers where Enter should insert a newline (the post composer);
 *   call `resolveIds(text)` yourself on the explicit submit button.
 */
export function useMentionAutocomplete({ members, onSubmit }: { members: MentionUser[]; onSubmit?: (text: string, mentionIds: string[]) => void }) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState<string | null>(null); // active "@…" token (null = closed)
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return members.filter((m) => (m.name ?? m.email ?? "").toLowerCase().includes(q)).slice(0, 6);
  }, [query, members]);
  useEffect(() => setActive(0), [query]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@(\S*)$/); // "@" at start or after a space, token up to caret
    setQuery(m ? m[1] : null);
  };

  const pick = (u: MentionUser) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const m = text.slice(0, caret).match(/(?:^|\s)@(\S*)$/);
    if (!m) return;
    const at = caret - m[1].length - 1; // index of the "@"
    const name = u.name ?? u.email ?? "user";
    const insert = `@${name} `;
    setText(text.slice(0, at) + insert + text.slice(caret));
    setMentions((prev) => (prev.some((x) => x.id === u.id) ? prev : [...prev, { id: u.id, name }]));
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); const pos = at + insert.length; el.setSelectionRange(pos, pos); });
  };

  /** Final mention ids whose "@Name" is still present in the given text. */
  const resolveIds = (content: string) => [...new Set(mentions.filter((mm) => content.includes(`@${mm.name}`)).map((mm) => mm.id))];

  const reset = () => { setText(""); setMentions([]); setQuery(null); };
  const seed = (t: string, ms: { id: string; name: string }[]) => { setText(t); setMentions(ms); setQuery(null); };

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    onSubmit?.(content, resolveIds(content));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    if (onSubmit && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return { text, setText, mentions, query, matches, active, ref, onChange, onKeyDown, pick, resolveIds, reset, seed, submit, open: query !== null && matches.length > 0 };
}
