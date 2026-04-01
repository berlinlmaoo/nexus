# Design System Strategy: The Architectural Document

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Atheneum"**
This design system moves beyond the "grid-and-border" constraints of traditional project management tools. Instead of a rigid database, the system treats project management as a high-end editorial experience. We blend the quiet, contemplative whitespace of a luxury manuscript (Notion-inspired) with the high-velocity precision of a cockpit (Asana-inspired).

The goal is **Intentional Asymmetry**. By utilizing generous `spacing-12` and `spacing-16` margins alongside dense, high-utility task modules, we create a rhythm that allows the user’s brain to breathe between moments of intense focus. We are not just building a tool; we are curating a workspace.

---

## 2. Color & Atmospheric Depth
Our palette is rooted in `primary (#0c1427)`, a deep, authoritative midnight blue that provides the "anchor" for all navigation and high-level actions.

### The "No-Line" Rule
**Borders are a failure of hierarchy.** In this system, 1px solid borders for sectioning are strictly prohibited. Separating the sidebar from the main canvas or the task list from the inspector must be achieved through background shifts:
*   **Sidebar:** `surface_container_low`
*   **Main Canvas:** `surface` (The pure, breathable white background)
*   **Task Details:** `surface_container_highest`

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. We use tonal transitions to indicate "elevation" rather than shadows:
*   **Base Layer:** `surface` (#f7f9fb) for the primary document body.
*   **Secondary Layer:** `surface_container` for persistent utility areas.
*   **Floating Elements:** `surface_container_lowest` (#ffffff) for cards or popovers that need to "pop" against the gray-tinted backgrounds.

### Glass & Gradient (The "Soul" Rule)
To avoid a flat, "SaaS-template" look:
*   **Hero CTAs:** Use a subtle linear gradient from `primary` to `primary_container`.
*   **Modals/Overlays:** Utilize `surface_container_lowest` at 80% opacity with a `backdrop-blur: 24px`. This allows the vibrant status colors (`error`, `on_tertiary_container`) to bleed through the background, softening the interface.

---

## 3. Typography: The Editorial Scale
We employ a dual-font strategy to balance character with utility.

*   **Display & Headlines (Manrope):** Use `display-md` and `headline-lg` for project titles and dashboard summaries. Manrope’s geometric nature provides a "designed" feel that Inter lacks.
*   **Interface & Utility (Inter):** Use `body-md` for tasks and `label-sm` for metadata. Inter’s high x-height ensures legibility at small scales in dense task lists.
*   **Hierarchy Tip:** Always pair a `headline-sm` title with `body-sm` metadata in `on_surface_variant` to create clear visual "groupings" without needing containers.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are too "heavy" for an editorial aesthetic. We use **Ambient Shadows** and **Tonal Stacking**.

*   **The Layering Principle:** Place a `surface_container_lowest` card on top of a `surface_container_low` section. The slight delta in hex codes creates a natural edge that is felt rather than seen.
*   **Ambient Shadows:** For floating menus (like a "Change Status" dropdown), use: `box-shadow: 0 12px 32px -4px rgba(19, 28, 46, 0.08)`. The shadow is tinted with our `on_primary_fixed` color to maintain tonal harmony.
*   **The Ghost Border Fallback:** If an element (like a search bar) disappears into the background, use `outline_variant` at **15% opacity**. Never use 100% opacity for lines.

---

## 5. Components

### Buttons: The Kinetic Core
*   **Primary:** `primary` background with `on_primary` text. Use `rounded-DEFAULT (8px)`.
*   **Secondary:** `secondary_container` with `on_secondary_container`. These should feel like part of the background until hovered.
*   **Interaction:** On hover, primary buttons should shift to `primary_container` with a subtle `xl` ambient shadow.

### Input Fields & Search
Forbid the "boxed" look. Use a `surface_container_high` background with no border. Upon focus, transition the background to `surface_container_lowest` and apply a `ghost border` using `primary` at 20% opacity.

### Cards & Task Lists: The "Invisible" List
*   **No Dividers:** Never use `<hr>` or border-bottom to separate tasks. 
*   **Vertical Rhythm:** Use `spacing-3` (1rem) as a consistent gutter between list items. Use a background hover state of `surface_variant` to indicate interactivity.
*   **Status Indicators:** Use `tertiary_container` for "In Progress" and `error_container` for "Blocked." These should be subtle "pills" with `label-sm` typography.

### Contextual Sidebar
The sidebar should be a solid block of `surface_container_low`. Use `title-sm` for category headers in `on_surface_variant` (all caps, letter-spacing: 0.05rem) to give it a structured, architectural feel.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use `spacing-12` (4rem) for top-level page padding to create a "gallery" feel.
*   **Do** use `rounded-md` (12px) for larger layout containers while keeping buttons at `rounded-DEFAULT` (8px).
*   **Do** use "Optical Alignment"—sometimes a status dot needs to be 1px higher than the text to *look* centered.

### Don't:
*   **Don't** use pure black (#000) for text. Always use `on_surface` or `on_background`.
*   **Don't** use shadows on buttons that are sitting on a white `surface`. Use tonal shifts instead.
*   **Don't** crowd the screen. If a view feels cluttered, increase the `surface_container` padding rather than adding more lines.

---

## 7. Director’s Final Note
Design is the art of subtraction. In this system, every line you *don't* draw makes the content more powerful. Trust the white space, lean into the deep slate of our primary blues, and let the typography do the heavy lifting. We are building a sanctuary for productivity.