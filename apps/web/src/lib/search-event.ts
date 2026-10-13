/** Opens the global search (⌘K) from a button: the sidebar, the phone header, the dashboard's search box. */
export const OPEN_SEARCH_EVENT = "nexus:open-search";
export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
