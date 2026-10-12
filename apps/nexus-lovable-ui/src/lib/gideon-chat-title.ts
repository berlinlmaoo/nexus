import { t } from "@/lib/lang";

/**
 * A saved GIDEON chat is titled with its first prompt. When that prompt was one of the suggestion chips,
 * it was saved in the language the person had then; shown later in the other language it read wrong
 * (QA N-07: "What's overdue for me?" in the Indonesian list). Known chips are shown in the current
 * language, whichever language they were saved in; anything a person typed stays as typed.
 */
const CHIP_KEYS = [
  "What's overdue for me?",
  "Summarize my week across projects",
  "What did my team decide recently? Cite the sources.",
  "Summarize this page",
  "Find the action items in this page",
  "What questions does this page leave open?",
  "What's the latest on this task?",
  "Break this task into subtasks",
  "Draft a status comment for this task",
];

export function chatTitleText(title: string | null | undefined): string | null | undefined {
  if (!title) return title;
  const s = title.trim();
  for (const k of CHIP_KEYS) if (s === k || s === t(k, undefined, "id")) return t(k);
  return title;
}
