'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

interface GideonButtonProps {
  isOpen: boolean
  onClick: () => void
}

export function GideonButton({ isOpen, onClick }: GideonButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'fixed bottom-20 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 overflow-hidden',
        'bg-zinc-900',
        isOpen && 'scale-0 opacity-0 pointer-events-none'
      )}
      aria-label="Toggle GIDEON AI Assistant"
      title="GIDEON AI Assistant"
    >
      <Image
        src="/logos/gideon-icon-white.png"
        alt="GIDEON"
        width={56}
        height={56}
        className="h-10 w-10 object-contain"
      />

    </button>
  )
}
