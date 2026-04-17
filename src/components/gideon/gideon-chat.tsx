"use client"

import dynamic from "next/dynamic"
import { useAppStore } from "@/stores/app-store"
import { GideonButton } from "./gideon-button"
import { AnimatePresence, motion } from "framer-motion"

const GideonPanel = dynamic(
  () => import("./gideon-panel").then((mod) => mod.GideonPanel),
  { ssr: false }
)

export function GideonChat() {
  const gideonOpen = useAppStore((state) => state.gideonOpen)
  const toggleGideon = useAppStore((state) => state.toggleGideon)

  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-4 md:bottom-6 md:right-6">
      <AnimatePresence>
        {gideonOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.9, y: 20, filter: "blur(10px)" }}
            className="flex h-[min(700px,calc(100vh-8rem-env(safe-area-inset-bottom)))] w-[min(440px,calc(100vw-1rem))] max-h-[calc(100vh-8rem-env(safe-area-inset-bottom))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-highest/80 backdrop-blur-2xl shadow-2xl shadow-primary/20 sm:max-w-[calc(100vw-2rem)] sm:rounded-[2.5rem] md:h-[700px] md:max-h-[calc(100vh-8rem)] md:w-[440px]"
          >
            <GideonPanel onClose={() => toggleGideon()} />
          </motion.div>
        )}
      </AnimatePresence>

      <GideonButton isOpen={gideonOpen} onClick={() => toggleGideon()} />
    </div>
  )
}
