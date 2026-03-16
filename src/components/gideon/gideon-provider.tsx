'use client'

import { GideonChat } from './gideon-chat'

export function GideonProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <GideonChat />
    </>
  )
}
