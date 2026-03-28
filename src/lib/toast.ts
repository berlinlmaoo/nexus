import { toast } from "sonner"

/**
 * Show a success toast.
 */
export function toastSuccess(message: string) {
  toast.success(message)
}

/**
 * Show an error toast.
 */
export function toastError(message: string) {
  toast.error(message)
}

/**
 * Show a toast with an undo action.
 * Returns a promise that resolves to true if undo was NOT clicked (action confirmed),
 * or false if undo WAS clicked (action should be reversed).
 *
 * Usage:
 *   const confirmed = await toastWithUndo("Task deleted", async () => {
 *     // restore the task
 *     await fetch(`/api/tasks/${id}`, { method: "POST", body: ... })
 *   })
 */
export function toastWithUndo(
  message: string,
  onUndo: () => void | Promise<void>,
  duration = 5000
) {
  let undone = false

  toast(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        undone = true
        onUndo()
        toast.success("Action undone")
      },
    },
  })

  return new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(!undone), duration + 500)
  })
}

/**
 * Show a loading toast that resolves to success or error.
 *
 * Usage:
 *   toastPromise(
 *     fetch("/api/tasks", { method: "POST", ... }),
 *     { loading: "Creating task...", success: "Task created!", error: "Failed to create task" }
 *   )
 */
export function toastPromise<T>(
  promise: Promise<T>,
  messages: { loading: string; success: string; error: string }
) {
  return toast.promise(promise, messages)
}
