import { create } from 'zustand'

interface AppState {
  sidebarOpen: boolean
  gideonOpen: boolean
  activeProjectId: string | null
  toggleSidebar: () => void
  toggleGideon: () => void
  setActiveProject: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  gideonOpen: false,
  activeProjectId: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleGideon: () => set((state) => ({ gideonOpen: !state.gideonOpen })),
  setActiveProject: (id) => set({ activeProjectId: id }),
}))
