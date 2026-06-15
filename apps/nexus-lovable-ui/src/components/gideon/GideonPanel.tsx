import { useEffect, useRef, useState } from "react";
import { BarChart2, Image as ImageIcon, Loader2, MoreHorizontal, Send, Sparkles, Wrench, X } from "lucide-react";
import { streamGideon, type GideonMessage } from "@/lib/gideon";
import { cn } from "@/lib/utils";

type ChatTurn = GideonMessage & { tools?: string[]; streaming?: boolean };

export function GideonPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history: GideonMessage[] = [...turns.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
    setTurns((cur) => [...cur, { role: "user", content: text }, { role: "assistant", content: "", streaming: true, tools: [] }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    const tools: string[] = [];

    await streamGideon(history, (ev) => {
      if (ev.type === "text") {
        acc += ev.content;
        setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, content: acc }; return next; });
      } else if (ev.type === "tool_result") {
        if (ev.name) tools.push(ev.name);
        setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, tools: [...tools] }; return next; });
      } else if (ev.type === "error") {
        acc += (acc ? "\n\n" : "") + `⚠️ ${ev.content ?? "Something went wrong."}`;
        setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, content: acc }; return next; });
      }
    }, { signal: controller.signal }).catch(() => {});

    setTurns((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, streaming: false }; return next; });
    setBusy(false);
  };

  return (
    <div className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
      <div className="flex items-center gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><div className="text-sm font-bold">Gideon</div><div className="text-[11px] text-muted-foreground">AI assistant · acts on your workspace</div></div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary/60" />
              <p className="text-sm font-semibold">Ask Gideon anything</p>
              <p className="mt-1 text-xs text-muted-foreground">“Create a task to ship the landing page”, “What’s overdue?”, “Summarize project Atlas”.</p>
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", t.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {t.tools && t.tools.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {t.tools.map((name, j) => <span key={j} className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"><Wrench className="h-2.5 w-2.5" /> {name}</span>)}
                </div>
              )}
              {t.content ? <span className="whitespace-pre-wrap">{t.content}</span> : t.streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          </div>
        ))}
      </div>

      {/* creative-card composer (21st.dev ruixenui/creative-card) */}
      <div className="border-t border-border p-3">
        <div className="relative flex w-full flex-col overflow-hidden rounded-2xl p-[2px]">
          {/* glow */}
          <div aria-hidden className="pointer-events-none absolute -left-2 -top-2 h-8 w-8 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,255,255,0.15),transparent_70%)] blur-sm" />

          {/* chat box */}
          <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40 backdrop-blur">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message Gideon…✨"
              className="h-14 w-full resize-none bg-transparent p-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-end justify-between p-3">
              <div className="flex gap-3">
                {ICON_ACTIONS.map(({ Icon, title, prompt }) => (
                  <button key={title} type="button" title={title} aria-label={title} onClick={() => setInput((cur) => (cur ? cur : prompt))} className="flex cursor-pointer border-none bg-transparent text-foreground/25 transition-all duration-300 hover:-translate-y-1 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"><Icon size={20} /></button>
                ))}
              </div>
              <button onClick={send} disabled={!input.trim() || busy} aria-label="Send" className="flex rounded-lg border-none bg-gradient-to-t from-gray-400 via-gray-300 to-gray-500 p-1 shadow-inner outline-none transition-all duration-150 active:scale-95 disabled:opacity-50 dark:from-gray-800 dark:via-gray-600 dark:to-gray-800">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 p-2 text-gray-600 backdrop-blur-sm dark:bg-black/10 dark:text-gray-300">
                  {busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} className="transition-all duration-300 hover:text-gray-900 hover:drop-shadow-[0_0_5px_#fff] dark:hover:text-white" />}
                </span>
              </button>
            </div>
          </div>

          {/* tags */}
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-2 py-3 text-xs">
              {SUGGESTIONS.map((tag) => (
                <button key={tag} onClick={() => setInput(tag)} className="cursor-pointer select-none rounded-lg border border-gray-300 bg-white px-2 py-1 transition-colors hover:border-primary/50 hover:text-primary dark:border-gray-800 dark:bg-black">{tag}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ICON_ACTIONS = [
  { Icon: ImageIcon, title: "Generate image", prompt: "Generate an image of " },
  { Icon: BarChart2, title: "Analyze data", prompt: "Analyze this data: " },
  { Icon: MoreHorizontal, title: "Explore more", prompt: "Explore more about " },
];

const SUGGESTIONS = ["Generate Image", "Analyze Data", "Explore More"];
