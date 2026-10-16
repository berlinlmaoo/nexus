import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { toPng, toSvg } from "html-to-image";
import { Copy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { formatDateSerial, formatGrouped, type SheetData, type SheetEngine } from "@/lib/sheet-formula";
import type { ChartSpec, Hex } from "@/lib/sheet-model";
import { chartData, histogramBins, scorecardValues, seriesColor, stackingOf, waterfallSteps, type ChartData } from "@/lib/sheet-chart";
import { Floating, type FloatAnchor } from "./sheet-float";
import { MenuItem, MenuLabel, MenuSep } from "./sheet-menu-ui";

// ── Number formatting (Indonesian: 1.234,5 · 1,5 jt) ─────────────────────────────────────────────

const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? formatGrouped(v, 2) : v == null ? "" : String(v));
const fmtTick = (v: unknown): string => (typeof v === "number" && Math.abs(v) >= 1e6 ? compact.format(v) : fmtNum(v));
const fmtPct = (v: unknown): string => (typeof v === "number" ? `${Math.round(v * 100)}%` : "");

/** Readable text on a user-chosen background (dark grey on light colours, light on dark). */
function inkOn(bg: Hex | undefined): { text: string; muted: string; grid: string } {
  if (!bg) return { text: "var(--foreground)", muted: "var(--muted-foreground)", grid: "var(--border)" };
  const n = parseInt(bg.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? { text: "#202124", muted: "#5f6368", grid: "#dadce0" } : { text: "#ffffff", muted: "#e8eaed", grid: "rgba(255,255,255,0.25)" };
}

const legendProps = (pos: NonNullable<ChartSpec["legend"]>) =>
  pos === "left" || pos === "right"
    ? { layout: "vertical" as const, align: pos, verticalAlign: "middle" as const }
    : { layout: "horizontal" as const, align: "center" as const, verticalAlign: pos === "top" ? ("top" as const) : ("bottom" as const) };

/**
 * One chart drawn from the sheet: every type Sheets offers in NEXUS (column/bar with stacking, line,
 * area incl. stepped, pie/donut, scatter/bubble, combo, histogram, radar, waterfall, scorecard and
 * table), with the editor's Customise options. No usable data → Sheets' big grey placeholder.
 */
export function ChartView({ spec, data, engine, theme, width, height }: {
  spec: ChartSpec;
  data: SheetData;
  engine: SheetEngine;
  /** The sheet theme's accent colours (used before Sheets' default series colours). */
  theme?: Hex[];
  width: number;
  height: number;
}) {
  const { t } = useLang();
  const cd = useMemo(() => chartData(spec, data, engine), [spec, data, engine]);
  const ink = inkOn(spec.bg);
  const titleH = (spec.title ? 22 : 0) + (spec.subtitle ? 16 : 0) + (spec.title || spec.subtitle ? 6 : 0);
  const w = Math.max(40, width), h = Math.max(30, height - titleH);
  const box: CSSProperties = { width, height, background: spec.bg ?? undefined, color: ink.text };

  let body: ReactNode;
  if (spec.type === "scorecard") body = <Scorecard spec={spec} data={data} engine={engine} w={w} h={h} ink={ink} />;
  else if (cd.empty) body = <Placeholder w={w} h={h} text={t("Add a series to start visualising your data")} />;
  else if (spec.type === "table") body = <TableChart cd={cd} w={w} h={h} />;
  else body = <Plot spec={spec} cd={cd} theme={theme} w={w} h={h} ink={ink} t={t} />;

  return (
    <div style={box} className="flex flex-col overflow-hidden">
      {(spec.title || spec.subtitle) && (
        <div className="shrink-0 px-3 pt-1.5" style={{ height: titleH }}>
          {spec.title && <div className="truncate text-[14px] font-medium leading-[22px]">{spec.title}</div>}
          {spec.subtitle && <div className="truncate text-[11px] leading-4" style={{ color: ink.muted }}>{spec.subtitle}</div>}
        </div>
      )}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

function Placeholder({ w, h, text }: { w: number; h: number; text: string }) {
  const size = Math.max(14, Math.min(52, Math.min(w / 9, h / 4.5)));
  return (
    <div className="grid h-full place-items-center px-4 text-center font-normal leading-[1.1] text-muted-foreground/80" style={{ width: w, height: h, fontSize: size }}>
      {text}
    </div>
  );
}

function Scorecard({ spec, data, engine, w, h, ink }: { spec: ChartSpec; data: SheetData; engine: SheetEngine; w: number; h: number; ink: ReturnType<typeof inkOn> }) {
  const { t } = useLang();
  const v = useMemo(() => scorecardValues(spec, data, engine), [spec, data, engine]);
  if (v.key === null && !v.keyText) return <Placeholder w={w} h={h} text={t("Add a series to start visualising your data")} />;
  const delta = v.key !== null && v.baseline !== null ? v.key - v.baseline : null;
  const pct = delta !== null && v.baseline ? delta / Math.abs(v.baseline) : null;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center" style={{ width: w, height: h }}>
      <div className="max-w-full truncate font-normal tabular-nums leading-none" style={{ fontSize: Math.max(18, Math.min(64, h / 2.6, w / 6)) }}>{v.keyText}</div>
      {delta !== null && (
        <div className="text-[13px] font-medium tabular-nums" style={{ color: up ? "#137333" : "#a50e0e" }}>
          {up ? "▲" : "▼"} {pct !== null ? `${formatGrouped(Math.abs(pct) * 100, 1)}%` : fmtNum(Math.abs(delta))}
        </div>
      )}
      {spec.xTitle && <div className="truncate text-[11px]" style={{ color: ink.muted }}>{spec.xTitle}</div>}
    </div>
  );
}

function TableChart({ cd, w, h }: { cd: ChartData; w: number; h: number }) {
  const { t } = useLang();
  return (
    <div className="overflow-auto" style={{ width: w, height: h }}>
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {cd.labels && <th className="border-b border-border px-2 py-1 text-left font-semibold">{cd.xName || t("Label")}</th>}
            {cd.series.map((s) => <th key={s.source} className="border-b border-border px-2 py-1 text-right font-semibold">{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {cd.categories.map((c, i) => (
            <tr key={i} className="odd:bg-transparent even:bg-muted/40">
              {cd.labels && <td className="border-b border-border/60 px-2 py-0.5">{c}</td>}
              {cd.series.map((s) => <td key={s.source} className="border-b border-border/60 px-2 py-0.5 text-right tabular-nums">{fmtNum(s.values[i])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Plot({ spec, cd, theme, w, h, ink, t }: {
  spec: ChartSpec; cd: ChartData; theme?: Hex[]; w: number; h: number; ink: ReturnType<typeof inkOn>;
  t: (en: string, vars?: Record<string, string | number>) => string;
}) {
  const color = (i: number) => seriesColor(i, spec, theme);
  const rows = useMemo(
    () => cd.categories.map((x, i) => {
      const o: Record<string, unknown> = { x };
      cd.series.forEach((s, k) => { o[`s${k}`] = s.values[i]; });
      return o;
    }),
    [cd],
  );
  const type = spec.type;
  const stacking = stackingOf(type);
  const pie = type === "pie" || type === "donut";
  const legendPos = spec.legend ?? (pie ? "right" : cd.series.length > 1 && type !== "histogram" && type !== "waterfall" ? "top" : "none");
  const legend = legendPos !== "none" ? <Legend {...legendProps(legendPos)} iconSize={9} wrapperStyle={{ fontSize: 11, color: ink.text }} /> : null;
  const grid = spec.gridlines !== false;
  const tick = { fill: ink.muted, fontSize: 10 };
  const margin = { top: 12, right: 16, bottom: spec.xTitle ? 18 : 4, left: spec.yTitle ? 10 : 0 };
  const valueDomain: [number | ((m: number) => number), number | "auto"] = [spec.yMin ?? ((m: number) => Math.min(0, m)), spec.yMax ?? "auto"];
  const pctAxis = stacking === "percent";
  const valueFmt = pctAxis ? fmtPct : fmtTick;
  const tooltip = <Tooltip formatter={(v: unknown) => fmtNum(v)} contentStyle={{ fontSize: 11, borderRadius: 8 }} isAnimationActive={false} />;
  const xLabel = spec.xTitle ? { value: spec.xTitle, position: "insideBottom" as const, offset: -12, fill: ink.muted, fontSize: 11 } : undefined;
  const yLabel = spec.yTitle ? { value: spec.yTitle, angle: -90, position: "insideLeft" as const, fill: ink.muted, fontSize: 11, style: { textAnchor: "middle" as const } } : undefined;
  const labels = (key: string, position: "top" | "right" | "center" = "top") =>
    spec.dataLabels ? <LabelList dataKey={key} position={position} formatter={(v: unknown) => fmtNum(v)} style={{ fontSize: 10, fill: ink.text }} /> : null;
  const gridEl = grid ? <CartesianGrid stroke={ink.grid} vertical={false} /> : null;
  const catAxis = <XAxis dataKey="x" tick={tick} tickLine={false} axisLine={{ stroke: ink.grid }} label={xLabel} interval="preserveStartEnd" />;
  const valAxis = <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={valueFmt} domain={valueDomain} allowDataOverflow={spec.yMin !== undefined || spec.yMax !== undefined} label={yLabel} width={yLabel ? 56 : 44} />;
  const common = { width: w, height: h, data: rows, margin };

  switch (type) {
    case "column": case "columnStacked": case "column100":
      return (
        <BarChart {...common} stackOffset={pctAxis ? "expand" : undefined} barCategoryGap="20%">
          {gridEl}{catAxis}{valAxis}{tooltip}{legend}
          {cd.series.map((s, k) => (
            <Bar key={k} dataKey={`s${k}`} name={s.name} fill={color(k)} stackId={stacking !== "none" ? "a" : undefined} isAnimationActive={false}>
              {labels(`s${k}`, stacking !== "none" ? "center" : "top")}
            </Bar>
          ))}
        </BarChart>
      );
    case "bar": case "barStacked": case "bar100":
      return (
        <BarChart {...common} layout="vertical" stackOffset={pctAxis ? "expand" : undefined} barCategoryGap="20%">
          {grid && <CartesianGrid stroke={ink.grid} horizontal={false} />}
          <XAxis type="number" tick={tick} tickLine={false} axisLine={false} tickFormatter={valueFmt} domain={valueDomain} allowDataOverflow={spec.yMin !== undefined || spec.yMax !== undefined} label={spec.yTitle ? { ...yLabel!, angle: 0, position: "insideBottom", offset: -12 } : undefined} />
          <YAxis type="category" dataKey="x" tick={tick} tickLine={false} axisLine={{ stroke: ink.grid }} width={Math.min(120, Math.max(40, w / 5))} label={spec.xTitle ? { ...xLabel!, angle: -90, position: "insideLeft" } : undefined} />
          {tooltip}{legend}
          {cd.series.map((s, k) => (
            <Bar key={k} dataKey={`s${k}`} name={s.name} fill={color(k)} stackId={stacking !== "none" ? "a" : undefined} isAnimationActive={false}>
              {labels(`s${k}`, stacking !== "none" ? "center" : "right")}
            </Bar>
          ))}
        </BarChart>
      );
    case "line": case "lineSmooth":
      return (
        <LineChart {...common}>
          {gridEl}{catAxis}{valAxis}{tooltip}{legend}
          {cd.series.map((s, k) => (
            <Line key={k} dataKey={`s${k}`} name={s.name} stroke={color(k)} strokeWidth={2} dot={rows.length <= 30 ? { r: 2.5 } : false} type={type === "lineSmooth" ? "monotone" : "linear"} connectNulls isAnimationActive={false}>
              {labels(`s${k}`)}
            </Line>
          ))}
        </LineChart>
      );
    case "area": case "areaStacked": case "area100": case "areaStepped":
      return (
        <AreaChart {...common} stackOffset={pctAxis ? "expand" : undefined}>
          {gridEl}{catAxis}{valAxis}{tooltip}{legend}
          {cd.series.map((s, k) => (
            <Area key={k} dataKey={`s${k}`} name={s.name} stroke={color(k)} fill={color(k)} fillOpacity={0.3} strokeWidth={2}
              type={type === "areaStepped" ? "step" : "linear"} stackId={stacking !== "none" ? "a" : undefined} connectNulls isAnimationActive={false}>
              {labels(`s${k}`)}
            </Area>
          ))}
        </AreaChart>
      );
    case "pie": case "donut": {
      const s = cd.series[0];
      const slices = cd.categories.map((name, i) => ({ name, value: s.values[i] ?? 0, i })).filter((x) => x.value > 0);
      const r = Math.max(10, Math.min(w * (legendPos === "left" || legendPos === "right" ? 0.6 : 1), h) / 2 - 18);
      return (
        <PieChart width={w} height={h}>
          {tooltip}{legend}
          <Pie data={slices} dataKey="value" nameKey="name" outerRadius={r} innerRadius={type === "donut" ? r * 0.5 : 0} isAnimationActive={false} stroke="var(--card)"
            labelLine={false}
            label={spec.dataLabels === false ? false : ({ percent }: { percent?: number }) => ((percent ?? 0) >= 0.05 ? `${formatGrouped((percent ?? 0) * 100, 1)}%` : "")}>
            {slices.map((x) => <Cell key={x.i} fill={color(x.i)} />)}
          </Pie>
        </PieChart>
      );
    }
    case "scatter": case "bubble": {
      const numericX = cd.xKind === "num" || cd.xKind === "date";
      const xFmt = cd.xKind === "date" ? (v: unknown) => (typeof v === "number" ? formatDateSerial(v) : "") : fmtTick;
      const sets = type === "bubble"
        ? [{
          name: cd.series[numericX ? 0 : 1]?.name ?? "",
          points: cd.categories.map((name, i) => {
            const xs = numericX ? cd.xValues[i] : cd.series[0]?.values[i];
            const ys = numericX ? cd.series[0]?.values[i] : cd.series[1]?.values[i];
            const zs = numericX ? cd.series[1]?.values[i] : cd.series[2]?.values[i];
            return { x: xs, y: ys, z: zs ?? 1, name };
          }).filter((p) => p.x != null && p.y != null),
        }]
        : cd.series.map((s) => ({
          name: s.name,
          points: cd.categories.map((name, i) => ({ x: numericX ? cd.xValues[i] : i + 1, y: s.values[i], name })).filter((p) => p.x != null && p.y != null),
        }));
      return (
        <ScatterChart width={w} height={h} margin={margin}>
          {grid && <CartesianGrid stroke={ink.grid} />}
          <XAxis type="number" dataKey="x" name={cd.xName} tick={tick} tickLine={false} axisLine={{ stroke: ink.grid }} tickFormatter={xFmt} domain={["auto", "auto"]} label={xLabel} />
          <YAxis type="number" dataKey="y" tick={tick} tickLine={false} axisLine={false} tickFormatter={fmtTick} domain={[spec.yMin ?? "auto", spec.yMax ?? "auto"]} allowDataOverflow={spec.yMin !== undefined || spec.yMax !== undefined} label={yLabel} width={yLabel ? 56 : 44} />
          {type === "bubble" && <ZAxis type="number" dataKey="z" range={[40, 900]} />}
          {tooltip}{legend}
          {sets.map((set, k) => (
            <Scatter key={k} name={set.name} data={set.points} fill={color(k)} fillOpacity={type === "bubble" ? 0.6 : 1} isAnimationActive={false}>
              {spec.dataLabels ? <LabelList dataKey="y" position="top" formatter={(v: unknown) => fmtNum(v)} style={{ fontSize: 10, fill: ink.text }} /> : null}
            </Scatter>
          ))}
        </ScatterChart>
      );
    }
    case "combo":
      return (
        <ComposedChart {...common}>
          {gridEl}{catAxis}{valAxis}{tooltip}{legend}
          {cd.series.map((s, k) => k === 0
            ? <Bar key={k} dataKey={`s${k}`} name={s.name} fill={color(k)} isAnimationActive={false}>{labels(`s${k}`)}</Bar>
            : <Line key={k} dataKey={`s${k}`} name={s.name} stroke={color(k)} strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false}>{labels(`s${k}`)}</Line>)}
        </ComposedChart>
      );
    case "histogram": {
      const bins = histogramBins(cd.series.flatMap((s) => s.values));
      const hist = bins.map((b) => ({ x: `${fmtTick(b.from)}–${fmtTick(b.to)}`, s0: b.count }));
      return (
        <BarChart width={w} height={h} data={hist} margin={margin} barCategoryGap={1}>
          {gridEl}
          <XAxis dataKey="x" tick={tick} tickLine={false} axisLine={{ stroke: ink.grid }} label={xLabel} interval="preserveStartEnd" />
          {valAxis}{tooltip}{legend}
          <Bar dataKey="s0" name={cd.series.length === 1 ? cd.series[0].name : t("Count")} fill={color(0)} isAnimationActive={false}>{labels("s0")}</Bar>
        </BarChart>
      );
    }
    case "radar":
      return (
        <RadarChart width={w} height={h} data={rows} outerRadius={Math.max(10, Math.min(w, h) / 2 - 28)}>
          {grid && <PolarGrid stroke={ink.grid} />}
          <PolarAngleAxis dataKey="x" tick={tick} />
          <PolarRadiusAxis tick={tick} tickFormatter={fmtTick} domain={[spec.yMin ?? 0, spec.yMax ?? "auto"]} axisLine={false} />
          {tooltip}{legend}
          {cd.series.map((s, k) => <Radar key={k} dataKey={`s${k}`} name={s.name} stroke={color(k)} fill={color(k)} fillOpacity={0.2} isAnimationActive={false} />)}
        </RadarChart>
      );
    case "waterfall": {
      const steps = waterfallSteps(cd.series[0].values);
      const fall = steps.map((s, i) => ({
        x: s.kind === "total" ? t("Total") : cd.categories[i],
        range: [Math.min(s.start, s.end), Math.max(s.start, s.end)],
        value: s.value,
        kind: s.kind,
      }));
      const fill = (k: string) => (k === "total" ? "#9aa0a6" : k === "down" ? (spec.colors?.[1] ?? "#ea4335") : color(0));
      return (
        <BarChart width={w} height={h} data={fall} margin={margin}>
          {gridEl}{catAxis}{valAxis}
          <Tooltip formatter={(_v: unknown, _n: unknown, item: { payload?: { value?: number } }) => fmtNum(item?.payload?.value)} contentStyle={{ fontSize: 11, borderRadius: 8 }} isAnimationActive={false} />
          <Bar dataKey="range" name={cd.series[0].name} isAnimationActive={false}>
            {fall.map((f, i) => <Cell key={i} fill={fill(f.kind)} />)}
            {spec.dataLabels ? <LabelList dataKey="value" position="top" formatter={(v: unknown) => fmtNum(v)} style={{ fontSize: 10, fill: ink.text }} /> : null}
          </Bar>
        </BarChart>
      );
    }
    default:
      return null;
  }
}

// ── The floating chart object on the grid ───────────────────────────────────────────────────────

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: { h: Handle; style: CSSProperties; cursor: string }[] = [
  { h: "nw", style: { left: -4, top: -4 }, cursor: "nwse-resize" },
  { h: "n", style: { left: "calc(50% - 4px)", top: -4 }, cursor: "ns-resize" },
  { h: "ne", style: { right: -4, top: -4 }, cursor: "nesw-resize" },
  { h: "e", style: { right: -4, top: "calc(50% - 4px)" }, cursor: "ew-resize" },
  { h: "se", style: { right: -4, bottom: -4 }, cursor: "nwse-resize" },
  { h: "s", style: { left: "calc(50% - 4px)", bottom: -4 }, cursor: "ns-resize" },
  { h: "sw", style: { left: -4, bottom: -4 }, cursor: "nesw-resize" },
  { h: "w", style: { left: -4, top: "calc(50% - 4px)" }, cursor: "ew-resize" },
];
const MIN_W = 120, MIN_H = 80;
type Preview = { dx: number; dy: number; w: number; h: number };

/**
 * A chart floating over the grid (left/top in unzoomed px; the lead's container applies the zoom).
 * Click selects it; drag moves it and the eight handles resize it (live preview, committed on
 * release); the ⋮ button or a right-click opens Edit / Delete / Download (PNG, SVG) / Copy;
 * Delete removes a selected chart; double-click opens the editor.
 */
export function ChartObject({ spec, data, engine, theme, left, top, zoom, selected, canEdit, onSelect, onMove, onResize, onEdit, onDelete, onCopy }: {
  spec: ChartSpec;
  data: SheetData;
  engine: SheetEngine;
  theme?: Hex[];
  left: number;
  top: number;
  zoom: number;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  /** Final move, in unzoomed px. */
  onMove: (at: { dx: number; dy: number }) => void;
  /** Final size; `move` is set when a top/left handle also shifted the chart (unzoomed px). */
  onResize: (w: number, h: number, move?: { dx: number; dy: number }) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy?: () => void;
}) {
  const { t } = useLang();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [menu, setMenu] = useState<FloatAnchor | null>(null);
  const drag = useRef<{ x: number; y: number; mode: "move" | Handle; moved: boolean } | null>(null);
  const live = useRef<Preview | null>(null);
  const z = zoom > 0 ? zoom : 1;

  useEffect(() => { if (selected) boxRef.current?.focus({ preventScroll: true }); }, [selected]);

  const begin = (e: ReactPointerEvent, mode: "move" | Handle) => {
    // Events from the portaled menu bubble through React's tree: only the chart itself starts a drag.
    if (e.button !== 0 || !boxRef.current?.contains(e.target as Node)) return;
    e.stopPropagation();
    const wasSelected = selected;
    onSelect();
    boxRef.current?.focus({ preventScroll: true });
    // A finger first selects the chart (so a swipe still scrolls the sheet), then moves it.
    if (!canEdit || (e.pointerType === "touch" && !wasSelected && mode === "move")) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, mode, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.x) / z, dy = (ev.clientY - d.y) / z;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      let p: Preview;
      if (d.mode === "move") p = { dx, dy, w: spec.w, h: spec.h };
      else {
        let pw = spec.w, ph = spec.h, px = 0, py = 0;
        if (d.mode.includes("e")) pw = Math.max(MIN_W, spec.w + dx);
        if (d.mode.includes("s")) ph = Math.max(MIN_H, spec.h + dy);
        if (d.mode.includes("w")) { pw = Math.max(MIN_W, spec.w - dx); px = spec.w - pw; }
        if (d.mode.includes("n")) { ph = Math.max(MIN_H, spec.h - dy); py = spec.h - ph; }
        p = { dx: px, dy: py, w: pw, h: ph };
      }
      live.current = p;
      setPreview(p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = drag.current, p = live.current;
      drag.current = null;
      live.current = null;
      setPreview(null);
      if (!d?.moved || !p) return;
      const r = (n: number) => Math.round(n);
      if (d.mode === "move") onMove({ dx: r(p.dx), dy: r(p.dy) });
      else onResize(r(p.w), r(p.h), p.dx || p.dy ? { dx: r(p.dx), dy: r(p.dy) } : undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === "Delete" || e.key === "Backspace") && canEdit) { e.preventDefault(); e.stopPropagation(); onDelete(); }
    else if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey) && onCopy) { e.preventDefault(); e.stopPropagation(); onCopy(); }
    else if (e.key === "Enter" && canEdit) { e.preventDefault(); e.stopPropagation(); onEdit(); }
  };

  const download = async (kind: "png" | "svg") => {
    setMenu(null);
    const node = chartRef.current;
    if (!node) return;
    const opts = { backgroundColor: spec.bg ?? "#ffffff", pixelRatio: 2, cacheBust: true };
    try {
      const url = kind === "png" ? await toPng(node, opts) : await toSvg(node, opts);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(spec.title || t("Chart")).replace(/[\\/:*?"<>|]+/g, " ").trim() || "chart"}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* The browser refused to rasterise (e.g. a cross-origin font); nothing to save. */
    }
  };

  const w = preview?.w ?? spec.w, h = preview?.h ?? spec.h;
  const openMenuAtButton = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  };

  return (
    <div
      ref={boxRef}
      role="figure"
      aria-label={spec.title || t("Chart")}
      tabIndex={0}
      onPointerDown={(e) => begin(e, "move")}
      onDoubleClick={(e) => { if (!boxRef.current?.contains(e.target as Node)) return; e.stopPropagation(); if (canEdit) onEdit(); }}
      onContextMenu={(e) => {
        if (!boxRef.current?.contains(e.target as Node)) return;
        e.preventDefault(); e.stopPropagation(); onSelect(); setMenu({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute select-none border bg-card outline-none",
        selected ? "z-[6] border-primary" : "z-[5] border-border",
        canEdit && selected ? "cursor-move" : "cursor-default",
      )}
      style={{
        left: left + (preview?.dx ?? 0),
        top: top + (preview?.dy ?? 0),
        width: w,
        height: h,
        touchAction: selected && canEdit ? "none" : undefined,
      }}
    >
      <div ref={chartRef} className="h-full w-full overflow-hidden" style={{ background: spec.bg ?? undefined }}>
        <ChartView spec={spec} data={data} engine={engine} theme={theme} width={w - 2} height={h - 2} />
      </div>
      <button
        type="button"
        data-chart-chrome=""
        aria-label={t("Chart options")}
        title={t("Chart options")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { onSelect(); openMenuAtButton(e.currentTarget); }}
        className={cn(
          "absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:opacity-100",
          selected || menu ? "opacity-100" : "opacity-0 pointer-coarse:opacity-100! group-hover:opacity-100",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {selected && canEdit && HANDLES.map(({ h: hd, style, cursor }) => (
        <span
          key={hd}
          data-chart-chrome=""
          onPointerDown={(e) => begin(e, hd)}
          className="absolute h-2 w-2 border border-primary bg-card"
          style={{ ...style, cursor, touchAction: "none" }}
        />
      ))}
      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <Floating anchor={menu} role="menu" className="min-w-48 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop"
            onKeyDown={(e) => { if (e.key === "Escape") setMenu(null); }}>
            {canEdit && <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setMenu(null); onEdit(); }}>{t("Edit chart")}</MenuItem>}
            {canEdit && <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { setMenu(null); onDelete(); }}>{t("Delete chart")}</MenuItem>}
            {canEdit && <MenuSep />}
            <MenuLabel>{t("Download")}</MenuLabel>
            <MenuItem icon={<Download className="h-3.5 w-3.5" />} onClick={() => void download("png")}>{t("PNG image (.png)")}</MenuItem>
            <MenuItem icon={<Download className="h-3.5 w-3.5" />} onClick={() => void download("svg")}>{t("SVG image (.svg)")}</MenuItem>
            {onCopy && <MenuSep />}
            {onCopy && <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onClick={() => { setMenu(null); onCopy(); }}>{t("Copy chart")}</MenuItem>}
          </Floating>
        </>,
        document.body,
      )}
    </div>
  );
}
