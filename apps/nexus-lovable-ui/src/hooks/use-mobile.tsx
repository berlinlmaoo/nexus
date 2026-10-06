import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Phone-width viewport. Read synchronously on the first render (the app is a client-only SPA), so a phone
 * never renders the desktop variant first and then swaps it out.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);

  React.useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
