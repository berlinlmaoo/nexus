/**
 * What a session row in Settings → Security → Active sessions is: the NEXUS app (from X-Nexus-Client,
 * or the `NEXUS/<build>` User-Agent of iOS 0.1.5 and older) or a browser on an OS (from the User-Agent).
 * Pure, so it can be unit-tested. Labels are English; the caller translates the templates.
 */
export type DeviceKind = "phone" | "tablet" | "desktop" | "unknown";

export type DeviceLabel =
  | { type: "app"; platform: "ios" | "android"; version: string | null; build: string | null; kind: DeviceKind }
  | { type: "browser"; browser: string | null; os: string | null; kind: DeviceKind }
  | { type: "unknown"; kind: "unknown" };

const APP_TAG = /^(ios|android)\/(\d+(?:\.\d+){0,2})(?:[^/\s]*)(?:\/([^/\s]+))?/i;

export function describeDevice(userAgent: string | null | undefined, client: string | null | undefined): DeviceLabel {
  const ua = userAgent ?? "";
  const tag = APP_TAG.exec((client ?? "").trim());
  if (tag) {
    const platform = tag[1].toLowerCase() as "ios" | "android";
    return { type: "app", platform, version: tag[2], build: tag[3] ?? null, kind: /iPad|Tablet/i.test(ua) ? "tablet" : platform === "ios" && /Macintosh|Mac OS X/i.test(ua) && !/iPhone/i.test(ua) ? "desktop" : "phone" };
  }
  // iOS 0.1.5 and older: URLSession's default `NEXUS/<build> CFNetwork/… Darwin/…`.
  const legacy = /^NEXUS\/(\d+)\b/.exec(ua);
  if (legacy) return { type: "app", platform: "ios", version: null, build: legacy[1], kind: "phone" };
  // Android app without the header (okhttp).
  if (/^okhttp\//i.test(ua)) return { type: "app", platform: "android", version: null, build: null, kind: "phone" };
  if (!ua) return { type: "unknown", kind: "unknown" };

  const browser =
    /EdgA?\/|EdgiOS\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari"
    : null;
  const os =
    /iPad/.test(ua) ? "iPadOS"
    : /iPhone|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Macintosh|Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const kind: DeviceKind =
    /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet"
    : /iPhone|iPod|Mobile|Android/.test(ua) ? "phone"
    : os ? "desktop" : "unknown";
  if (!browser && !os) return { type: "unknown", kind: "unknown" };
  return { type: "browser", browser, os, kind };
}
