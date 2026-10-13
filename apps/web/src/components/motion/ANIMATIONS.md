# NEXUS Phaëthon — Animation / UX-motion Playbook

> **Read this first before any animation work.** This is the canonical reference so the
> conventions don't have to be re-explained each time. Edit it when conventions change.
>
> Stack: Vite + React + TS, Tailwind, **framer-motion `^12.40.0`**, `cn` from `@/lib/utils`.
> All motion **must** honor `prefers-reduced-motion` (a11y) — see the reduced-motion rule below.

---

## 0. Non-negotiable principles

1. **Reduced-motion aware.** Every animated component calls `const reduce = useReducedMotion()`.
   When `reduce` is true: no layout morphs, no infinite loops, entrances are instant, counters/bars
   jump to final value. Pattern: `initial={reduce ? false : {...}}`, and for `layoutId` pass
   `layoutId={reduce ? undefined : id}` + an opacity/scale fallback.
2. **Springs over linear.** Hover/press/morph use springs (`type: "spring"`). Entrances use the
   house ease `EASE_OUT = [0.16, 1, 0.3, 1]`.
3. **House aesthetic.** Gradient stat cards (`linear-gradient(150deg, from, to)` + soft glow shadow),
   rounded-3xl, white-on-gradient. Don't paste foreign palettes (e.g. the 21st.dev zinc/dark look) —
   extend our tokens instead.
4. **Token-friendly + tiny.** Prefer reusing/extending `src/components/motion/index.tsx` primitives
   over bespoke one-offs. Keep new primitives small and prop-driven.
5. **No deps without asking.** framer-motion is already in. Don't add animation libs.

---

## 1. The reusable toolkit — `src/components/motion/index.tsx`

All reduced-motion aware. Import: `import { Reveal, Lift, AnimatedBar, CountUp, Float } from "@/components/motion"`.

| Primitive | Signature | Use for |
|---|---|---|
| `Reveal` | `{children, delay?, y=16, className?}` | Fade + rise into view once. Stagger siblings with `delay={i*0.07}`. |
| `Lift` | `{children, className?, delay?, style?}` | Card wrapper: entrance + **hover lift (`y:-4`)** + **tap press (`scale:0.98`)**. |
| `AnimatedBar` | `{pct, className?, barClassName?, barStyle?, duration=0.9}` | Progress bar grows 0→pct% on first view. |
| `CountUp` | `{value, duration=1.1, decimals=0, className?}` | Number ticks 0→value when scrolled in. |
| `Float` | `{children, className?, distance=5, duration=3}` | Gentle infinite bob — mascots / tier badges. |

Plus: **`celebrate(message?)`** from `@/components/Celebration` — confetti/toast burst for success actions.

---

## 2. The signature pattern — **morph / expand (vibe "b")** ⭐ ACTIVE FOCUS

This is the "card mekar jadi modal" shared-layout morph (same core trick as the 21st.dev
ExpandableCard, but NEXUS-native). **Reference implementation: `src/routes/_app/dashboard.tsx`**
→ `StatCardButton` (collapsed) + `StatCardModal` (expanded), the Projects / Your Mission /
Monthly Quests cards.

### How the morph works
- The **collapsed trigger** and the **expanded panel** share the **same `layoutId`** string
  (e.g. `stat-card-${index}`). framer-motion auto-animates position+size between them when one
  mounts and the other unmounts (toggled by an `active` state + `AnimatePresence`).
- Sub-elements can each get their own `layoutId` (`title-…`, `image-…`) to morph independently
  (feels like unfolding, not a crossfade).
- Use **`useId()`** to keep layoutIds unique per instance so multiple triggers don't collide.
- Expanded panel renders via **`createPortal(…, document.body)`** so it sits above everything and
  escapes parent `overflow`.
- Dismiss: **Escape** key, **click backdrop**, **close button**. Lock `document.body.style.overflow`
  while open.
- Reduced-motion: drop the `layoutId` (pass `undefined`) and use a plain `initial/animate/exit`
  opacity+scale fade instead.

### ⭐ Preferred in this codebase: `MorphPanel` "genie-zoom" (smooth for ANY trigger→modal)
`src/components/motion/MorphPanel.tsx`. A `layoutId` content-morph only looks smooth when the
two elements have matching shape/structure (StatCard ↔ StatCardModal). For a thin row → tall
detail modal it glitches (content distorts, "geter" on close). Instead, `MorphPanel` **zooms the
modal out from the trigger's position** (pure transform `scale`+`translate` → 60fps, no reflow, no
content-morph glitch). Recipe:
```tsx
import { MorphPanel, rectCenter, type MorphOrigin } from "@/components/motion/MorphPanel";
const [sel, setSel] = useState<{…; origin?: MorphOrigin} | null>(null);
// trigger: capture the element's center (NOT the click point) so it zooms from the whole element
<button onClick={(e) => setSel({ …, origin: rectCenter(e.currentTarget) })}>…</button>
// for "expand from the whole card" when the trigger is a small button inside it:
//   rectCenter(e.currentTarget.closest("section"))
<AnimatePresence>
  {sel && <MyModal key={sel.id} origin={sel.origin} onClose={() => setSel(null)} />}
</AnimatePresence>
// MyModal renders <MorphPanel origin={origin} onClose={onClose}>…</MorphPanel>
```
Rules that keep it smooth: **never `backdrop-blur`** behind an animating panel (re-blurs the whole
screen every frame); **no `whileHover`/`layoutId` transforms** fighting the zoom on the trigger
(plain `active:scale-*` CSS is fine); pass the element's CENTER as origin; reduced-motion → plain
fade. Used by: UserXpLogModal, DayOffLogModal, LeaderboardExpandModal (See All), AttendanceCorrectionDrawer.

Keep the true `layoutId` morph (below) ONLY for matching-shape card↔card cases like the dashboard StatCards.

### Minimal recipe (copy + adapt)
```tsx
const [active, setActive] = useState(false);
const reduce = useReducedMotion();
const id = useId();
const lid = reduce ? undefined : `morph-${id}`;

// trigger
<motion.button layoutId={lid} onClick={() => setActive(true)}
  whileHover={reduce ? undefined : { y: -4 }} whileTap={reduce ? undefined : { scale: 0.98 }}>
  …collapsed content…
</motion.button>

// expanded — in a portal, inside <AnimatePresence>
{active && createPortal(
  <AnimatePresence>
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={() => setActive(false)} />
      <motion.div layoutId={lid} role="dialog" aria-modal="true"
        initial={reduce ? {opacity:0,scale:0.95} : undefined}
        animate={reduce ? {opacity:1,scale:1} : undefined}
        exit={reduce ? {opacity:0,scale:0.95} : undefined}
        className="relative z-10 …expanded styles…">
        …expanded content + close button + Escape/scroll-lock effect…
      </motion.div>
    </div>
  </AnimatePresence>, document.body)}
```
> When adding morph to a **button that opens a detail/drawer/sheet**, prefer wiring the existing
> trigger + its detail panel to a shared `layoutId` rather than introducing a new modal.

### Gotchas
- A `layoutId` must be **unique and stable**; reused/duplicate ids cause wrong morph targets.
- Both the trigger and the panel must be mounted in a place where framer-motion can measure them;
  portal is fine.
- Keep heavy content out of the morphing element's first paint (fade detail in with a small
  `delay: 0.15` secondary motion so the morph stays smooth).

### ⭐ Morph from a source that can MOVE/re-render (board card, list row) → GROW FROM TAP POINT (no shared layoutId)
A shared-`layoutId` morph ties the panel to the **source element's DOM node**. If that source can move
or unmount while the panel is open, framer either **yanks the panel away** with it OR — when the source
**changes parent** (e.g. a board card moving to another column = unmount from lane A, remount in lane B) —
**pollutes the layoutId's layout snapshot**, so the remounted card animates from the panel's stale
full-screen box. Either way: **backdrop blur stuck on screen, panel smeared/gone.**

**History / why detach-on-edit was NOT enough.** We first tried keeping the morph for OPEN and severing
the link (`morphLink → false`) on (a) morph-complete, (b) a 500 ms timer, and (c) `update.onMutate`. The
detach fixes the *panel-yank*, but it does **not** fix the *remount-pollution*: even fully detached, when
the card changes column the card itself animates from the panel's stale snapshot → the Section-change
blur came back. (Status/priority edits don't move the card across parents, so they were fine — which is
exactly why only **Section** reproduced it.)

**Resolution (current TaskDetailPanel): a manual FLIP from the card's MEASURED RECT — exact morph, zero
DOM coupling.** No shared `layoutId`. On `pointerdown` a global handler snapshots the tapped card's
`getBoundingClientRect()` (cards carry a `data-morph-id` matching the panel's `morphId`). On open the panel
measures its own natural rect, jumps the box exactly onto the card's rect (`transform-origin: top left`,
raw motion values `x/y/scaleX/scaleY`), then springs to identity — looks identical to the old layoutId
morph (card box expands into the panel), but the rect is just a number snapshot so a card that later moves
or unmounts can't touch the open panel. On close it re-measures the card's CURRENT rect (it may have moved
columns) and shrinks back there — **only if** the card is still on-screen and we opened from a rect; else a
neutral centred fade (so it never flies toward an empty region / a scrolled-away or filtered-out card).
`closing` state sets `pointer-events:none` on the aside the instant the close starts. `AnimatePresence` was
removed — the close animation runs, then `onClose()` unmounts. The board cards KEEP their own `layoutId`,
so board move animations are untouched.
```tsx
// module scope: capture rect of the tapped [data-morph-id] on pointerdown → lastMorph = { id, rect }
const sourceRect = useRef(morphId && lastMorph?.id === morphId ? lastMorph.rect : null);
useLayoutEffect(() => {                              // OPEN, before paint
  const p = el.getBoundingClientRect();             // panel natural rect (transforms still identity)
  const s = sourceRect.current;
  mx.set(s.left-p.left); my.set(s.top-p.top); msx.set(s.width/p.width); msy.set(s.height/p.height); // snap onto card
  fmAnimate(mx,0,SPRING); fmAnimate(my,0,SPRING); fmAnimate(msx,1,SPRING); fmAnimate(msy,1,SPRING);  // grow to panel
}, []);
<motion.aside style={{ x:mx, y:my, scaleX:msx, scaleY:msy, opacity:asideO, transformOrigin:'top left' }} />
```
**Rule of thumb:** a shared-`layoutId` morph is only safe when the source **stays mounted in place** while
the panel is open (e.g. dashboard StatCards). If the source can change column/parent/unmount, use the
measured-rect FLIP (above) — do NOT reintroduce the shared layoutId expecting a detach to save you.

---

## 3. Vibe "a" — micro-interactions (LATER)

Subtle per-button feedback. Recipe: `motion.button` with
`whileHover={{ y: -2 }}` / `whileTap={{ scale: 0.96 }}` (spring), or Tailwind
`transition-all active:scale-[0.98]` for non-motion buttons. Optional: icon wiggle
(`whileHover={{ rotate: [0,-8,8,0] }}`), ripple on tap. Keep it ≤150ms, reduced-motion off.

## 4. Vibe "c" — celebratory (LATER)

Success moments (check-in, claim quest, level-up, XP gain). Use **`celebrate("msg")`** for the
confetti/toast burst; pair with a one-shot pop (`animate={{ scale: [1, 1.15, 1] }}`) on the
affected number/badge. Already used in attendance check-in + quest claim.

---

## 5. File map
- `src/components/motion/index.tsx` — the primitives (Reveal/Lift/AnimatedBar/CountUp/Float).
- `src/components/Celebration.tsx` — `celebrate()`.
- `src/routes/_app/dashboard.tsx` — **reference morph** (StatCardButton/StatCardModal).
- Other morph/sheet refs: `components/tasks/TaskDetailPanel.tsx`, `components/projects/ProjectSettingsDrawer.tsx`,
  `routes/_app/projects/$projectId.tsx`, `routes/_app/my-tasks.tsx`, `components/MobileTabBar.tsx`.

## 6. Deploy note (this app)
Phaëthon frontend is built static: `npx vite build --outDir dist-staging` → `rsync -a --delete dist-staging/ dist/`.
Animation changes are **frontend-only** (no backend rebuild/recreate needed).

---

### Backlog / decisions
- **Active vibe: (b) morph/expand.** (a) micro-interactions + (c) celebratory = later, on request.
- **App-wide:** `components/ui/button.tsx` base now has hover-lift + tap-squish (`active:scale-[0.97] motion-reduce:transform-none`) → every `<Button>` has press feedback.

**Done (vibe-b pass 1):**
- Dashboard leaderboard avatars fixed (was initials).
- `XpRulesCard` (Aturan XP/Poin) → spring height-expand + chevron spin.
- Attendance crew-streak dot → hover-grow + tap; `AttendanceCorrectionDrawer` → spring pop.
- Leaderboard rows (dashboard card + full page) → clickable → **`UserXpLogModal`** (public per-user XP log, full transparency; backend `GET /api/gamification/xp-log?userId=` peer-scoped, non-BoD). Shared labels: `src/lib/xp-reason.ts` (`xpReasonInfo`).
- Attendance Day-off / Tanggal-merah `FunMetric` cards → clickable → `DayOffLogModal` (self, reuses `attendanceRequests("scope=me")`, flags Auto >120m deductions).
- Signal Inbox rows → clickable → route by `link`/`type` (attendance/messages/$taskId/$projectId).
- Dashboard "See All" leaderboard → inline expand (top-5 → all) then "Halaman penuh →".
- Room-booking row → press feedback (its composer already spring-pops).
