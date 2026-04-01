"use client"

import { useState } from "react"
import { useAppStore } from "@/stores/app-store"
import { GideonPanel } from "./gideon-panel"
import { GideonButton } from "./gideon-button"
import { AnimatePresence, motion } from "framer-motion"

export function GideonChat() {
  const { gideonOpen, toggleGideon } = useAppStore()

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
      <AnimatePresence>
        {gideonOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.9, y: 20, filter: "blur(10px)" }}
            className="w-[440px] max-w-[calc(100vw-2rem)] h-[700px] max-h-[calc(100vh-8rem)] bg-surface-container-highest/80 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl shadow-primary/20 border border-on-surface-variant/10 overflow-hidden flex flex-col"
          >
            <GideonPanel onClose={() => toggleGideon()} />
          </motion.div>
        )}
      </AnimatePresence>

      <GideonButton isOpen={gideonOpen} onClick={() => toggleGideon()} />
    </div>
  )
}
