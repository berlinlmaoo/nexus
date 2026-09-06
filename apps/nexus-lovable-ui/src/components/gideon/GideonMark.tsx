/**
 * The GIDEON mark.
 *
 * Drawn as a CSS mask rather than an <img>, so the black artwork takes `currentColor` and follows
 * the theme — the same trick the iOS asset uses by shipping as a template image. An <img> would
 * stay black and vanish against a dark panel.
 */
export function GideonMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block bg-current ${className}`}
      style={{
        WebkitMaskImage: "url(/gideon-mark.png)",
        maskImage: "url(/gideon-mark.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
