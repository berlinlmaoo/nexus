// Reusable motion primitives for the dashboard (framer-motion).
// Kept tiny + token-friendly so any card can opt into fun, tasteful animation.
// All primitives honor prefers-reduced-motion (a11y): when the user opts out,
// entrances are instant, bars/counters jump to their final value, and the
// infinite Float idle loop is disabled.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Fade + rise into view once. Use `delay` to stagger siblings. */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** Card-like wrapper that lifts + springs on hover and presses on tap. */
export function Lift({
  children,
  className,
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay }}
      whileHover={reduce ? undefined : { y: -4, transition: { type: "spring", stiffness: 400, damping: 18 } }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
    >
      {children}
    </motion.div>
  );
}

/** A progress bar (or any width) that grows from 0 → pct% on first view. */
export function AnimatedBar({
  pct,
  className,
  barClassName,
  barStyle,
  duration = 0.9,
}: {
  pct: number;
  className?: string;
  barClassName?: string;
  barStyle?: CSSProperties;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const target = `${Math.max(0, Math.min(100, pct))}%`;
  return (
    <div className={cn("overflow-hidden", className)}>
      <motion.div
        className={barClassName}
        style={reduce ? { ...barStyle, width: target } : barStyle}
        initial={reduce ? false : { width: 0 }}
        whileInView={reduce ? undefined : { width: target }}
        viewport={{ once: true }}
        transition={{ duration, ease: EASE_OUT }}
      />
    </div>
  );
}

/** Animated number counter that ticks 0 → value when scrolled into view. */
export function CountUp({
  value,
  duration = 1.1,
  decimals = 0,
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = value.toFixed(decimals);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => {
        node.textContent = v.toFixed(decimals);
      },
    });
    return () => controls.stop();
  }, [inView, value, duration, decimals, reduce]);
  return <span ref={ref} className={className}>{(reduce ? value : 0).toFixed(decimals)}</span>;
}

/** Gentle infinite float — for mascots / tier badges. Static under reduced-motion. */
export function Float({
  children,
  className,
  distance = 5,
  duration = 3,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -distance, 0] }}
      transition={{ duration, ease: "easeInOut", repeat: Infinity }}
    >
      {children}
    </motion.div>
  );
}
