import { create } from 'zustand'

interface AppState {
  sidebarOpen: boolean
  gideonOpen: boolean
  taskPanelOpen: boolean
  activeProjectId: string | null
  toggleSidebar: () => void
  toggleGideon: () => void
  setTaskPanelOpen: (open: boolean) => void
  setActiveProject: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  gideonOpen: false,
  taskPanelOpen: false,
  activeProjectId: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleGideon: () => set((state) => ({ gideonOpen: !state.gideonOpen })),
  setTaskPanelOpen: (open) => set({ taskPanelOpen: open }),
  setActiveProject: (id) => set({ activeProjectId: id }),
}))
