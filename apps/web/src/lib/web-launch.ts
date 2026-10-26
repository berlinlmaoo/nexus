/**
 * The web's 0.1.7 launch switch (owner, 22 Oct 2026). The web goes live with the big release, but a handful of
 * features ship to people only with the iPhone 0.1.7 release: until then the web hides them and shows those
 * screens as they were. Server-controlled — GET /api/app/config?platform=web → flags.web017Launch (default off on
 * prod, on on dev) — so turning it on needs no deploy.
 *
 * Hidden while off (UI only; every API stays open for iOS 0.1.7 and Android):
 *   • Pipeline v8: cashback, project contacts, budget (+ the category picker on cost lines), barter fields, the
 *     year filter, the new document types, All Pipelines (Projects row, board-title switcher, /pipelines), the
 *     new Excel columns;
 *   • Control Room › Announcements' "System" list (one combined list, as before);
 *   • changing / removing a group chat's photo;
 *   • the meeting notes entry points and GIDEON Memory.
 *
 * Fail closed: until the config has answered "true" (loading, an error, an older server) everything stays hidden,
 * so nothing flashes in and out. No React here: lib/meetings.ts has the hook (useWeb017Launch).
 */

export const WEB017_FLAG = "web017Launch";

type ConfigLike = { flags?: Record<string, unknown> | null } | null | undefined;

/** True only when the config says flags.web017Launch === true. */
export function web017On(config: ConfigLike): boolean {
  return config?.flags?.[WEB017_FLAG] === true;
}

/**
 * Pipeline v8 only (owner, 26 Oct 2026: Pipeline goes live on the web before the rest of 0.1.7):
 * flags.webPipelineV8 OR the whole launch switch.
 */
export function pipelineV8On(config: ConfigLike): boolean {
  return web017On(config) || config?.flags?.webPipelineV8 === true;
}

/** Pipeline document & link types before v8 (lib/pipeline.ts LINK_TYPES keeps the stored keys). */
export const LEGACY_LINK_TYPES = ["SPK", "Kontrak", "MOU", "Invoice", "Lainnya"] as const;

/**
 * The document types a new link may get. Off = the pre-v8 list; a document already saved with a newer type still
 * renders (its label comes from the type itself), only the picker is limited.
 */
export function linkTypesFor<T extends string>(on: boolean, all: readonly T[]): readonly string[] {
  return on ? all : LEGACY_LINK_TYPES;
}

/** The announcements list to ask for: by origin (Manual / System) when on, everything in one list when off. */
export function announcementOriginFor(on: boolean, picked: "manual" | "system"): "manual" | "system" | undefined {
  return on ? picked : undefined;
}

/** Meeting notes on the web: the server's own switch AND the launch switch. */
export function meetingNotesOn(config: ConfigLike): boolean {
  return config?.flags?.meetingNotesEnabled !== false && web017On(config);
}
