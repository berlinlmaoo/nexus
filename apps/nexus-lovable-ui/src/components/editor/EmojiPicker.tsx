import { useLang } from "@/lib/lang";

/**
 * A small, curated emoji grid for page icons and callouts (no emoji dataset shipped: the set people
 * actually pick for work pages). The page icon is stored as the emoji itself (Doc.icon), which the
 * released apps already show.
 */
const GROUPS: Array<{ label: string; emojis: string[] }> = [
  { label: "Work", emojis: ["📄", "📝", "📋", "📌", "📎", "🗂️", "📁", "📊", "📈", "📉", "🗓️", "⏰", "✅", "☑️", "🧾", "💼", "🏷️", "🔖", "📣", "📢", "💡", "🎯", "🚀", "🏁", "⚙️", "🛠️", "🔧", "🔒", "🔑", "🧭"] },
  { label: "Events", emojis: ["🎉", "🎊", "🎤", "🎧", "🎵", "🎶", "🎸", "🥁", "🎹", "🎬", "📸", "🎥", "🎟️", "🎫", "🍽️", "🍸", "☕", "🍕", "🏨", "✈️", "🚗", "🗺️", "📍", "🏢", "🏟️", "🌃", "🌅", "🎪", "🕺", "💃"] },
  { label: "People", emojis: ["😀", "😄", "😎", "🤩", "🥳", "🤔", "🙌", "👏", "👍", "👋", "🤝", "💪", "🙏", "👀", "🧠", "❤️", "🔥", "✨", "⭐", "🌟", "💯", "⚡", "🌈", "☀️", "🌙", "🌱", "🌸", "🍀", "🐝", "🦄"] },
  { label: "Signals", emojis: ["❗", "❓", "⚠️", "🚫", "⛔", "🛑", "🟢", "🟡", "🔴", "🔵", "🟣", "⚪", "⚫", "🟠", "🟤", "➡️", "⬆️", "⬇️", "🔁", "🔔", "💬", "📞", "✉️", "📦", "💰", "💳", "🧮", "📚", "🎓", "🏆"] },
];

export const ALL_EMOJIS = GROUPS.flatMap((g) => g.emojis);

export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useLang();
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{t(g.label)}</div>
          <div className="grid grid-cols-10 gap-0.5">
            {g.emojis.map((e) => (
              <button key={e} type="button" onClick={() => onPick(e)} className="grid h-7 w-7 place-items-center rounded-md text-lg transition-colors hover:bg-muted" aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
