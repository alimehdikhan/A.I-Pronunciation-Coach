import { create } from 'zustand'

interface UIState {
  settingsOpen: boolean
  commandOpen: boolean
  libraryOpen: boolean
  phonemeSheet: string | null
  setSettingsOpen: (open: boolean) => void
  setCommandOpen: (open: boolean) => void
  setLibraryOpen: (open: boolean) => void
  openPhoneme: (symbol: string | null) => void
}

export const useUI = create<UIState>()((set) => ({
  settingsOpen: false,
  commandOpen: false,
  libraryOpen: false,
  phonemeSheet: null,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  openPhoneme: (phonemeSheet) => set({ phonemeSheet }),
}))
