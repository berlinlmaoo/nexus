/**
 * What a session row in Settings → Security → Active sessions is: the NEXUS app (from X-Nexus-Client,
 * or the `NEXUS/<build>` User-Agent of iOS 0.1.5 and older) or a browser on an OS (from the User-Agent).
 * Pure, so it can be unit-tested. Labels are English; the caller translates the templates.
 */
export type DeviceKind = "phone" | "tablet" | "desktop" | "unknown";

export type DeviceLabel =
  | { type: "app"; platform: "ios" | "android"; version: string | null; build: string | null; kind: DeviceKind; os: AppleAppOs | null }
  | { type: "browser"; browser: string | null; os: string | null; kind: DeviceKind }
  | { type: "unknown"; kind: "unknown" };

/** Which Apple system the iOS-family app runs on, from its User-Agent; null when the UA does not say. */
export type AppleAppOs = "macOS" | "iPadOS" | "iOS";

/**
 * Since run 12 the iOS app sends `NEXUS/<build> (Macintosh; Mac OS X …)`, `(iPad; …)` or `(iPhone; …)`, so the
 * Mac and iPad sessions are no longer all "NEXUS app for iOS" (UI tour run 12, MC3). The older
 * `NEXUS/<build> CFNetwork/…` names no device: null, and the label stays as it was.
 */
function appleAppOs(ua: string): AppleAppOs | null {
  const m = /^NEXUS\/\d+[^(]*\(([^)]*)\)/.exec(ua);
  if (!m) return null;
  return /iPad/.test(m[1]) ? "iPadOS" : /iPhone|iPod/.test(m[1]) ? "iOS" : /Macintosh|Mac OS X/.test(m[1]) ? "macOS" : null;
}
const KIND_OF_OS: Record<AppleAppOs, DeviceKind> = { macOS: "desktop", iPadOS: "tablet", iOS: "phone" };

const APP_TAG = /^(ios|android)\/(\d+(?:\.\d+){0,2})(?:[^/\s]*)(?:\/([^/\s]+))?/i;

export function describeDevice(userAgent: string | null | undefined, client: string | null | undefined): DeviceLabel {
  const ua = userAgent ?? "";
  const tag = APP_TAG.exec((client ?? "").trim());
  if (tag) {
    const platform = tag[1].toLowerCase() as "ios" | "android";
    const os = platform === "ios" ? appleAppOs(ua) : null;
    return { type: "app", platform, version: tag[2], build: tag[3] ?? null, kind: os ? KIND_OF_OS[os] : /iPad|Tablet/i.test(ua) ? "tablet" : platform === "ios" && /Macintosh|Mac OS X/i.test(ua) && !/iPhone/i.test(ua) ? "desktop" : "phone", os };
  }
  // iOS 0.1.5 and older: URLSession's default `NEXUS/<build> CFNetwork/… Darwin/…`.
  const legacy = /^NEXUS\/(\d+)\b/.exec(ua);
  if (legacy) {
    const os = appleAppOs(ua);
    return { type: "app", platform: "ios", version: null, build: legacy[1], kind: os ? KIND_OF_OS[os] : "phone", os };
  }
  // Android app without the header (okhttp).
  if (/^okhttp\//i.test(ua)) return { type: "app", platform: "android", version: null, build: null, kind: "phone", os: null };
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
