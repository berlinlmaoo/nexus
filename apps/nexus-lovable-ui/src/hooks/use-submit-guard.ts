import { useCallback, useRef, useState } from "react";

/**
 * One in-flight guard for every "submit" button (bughunt 12 Oct 2026: double-click Send / Create / Add
 * posted twice — N-BUG-1, N-BUG-2, F-BUG-1, A-BUG-1, C-BUG-8, S-BUG-17).
 *
 * `disabled={isPending}` is not enough: the second click of a double-click lands before React re-renders
 * the disabled button. A ref flips synchronously, so the second call is dropped.
 *
 *   const [run, busy] = useSubmitGuard();
 *   <Button disabled={busy} onClick={() => run(() => createProject.mutateAsync())} />
 *
 * `run` returns undefined when a call is already in flight. A rejected promise is swallowed here (show the
 * error through the mutation's onError / state), so callers don't get an unhandled rejection.
 */
export function useSubmitGuard(): [run: <T>(fn: () => Promise<T> | T) => Promise<T | undefined> | undefined, busy: boolean] {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(<T,>(fn: () => Promise<T> | T) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    return Promise.resolve()
      .then(fn)
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  }, []);
  return [run, busy];
}
