import { create } from 'zustand'

interface VoiceUI {
  open: boolean
  setOpen: (open: boolean) => void
}

/** Whether the "talk to your coach" screen is showing. */
export const useVoiceUI = create<VoiceUI>()((set) => ({ open: false, setOpen: (open) => set({ open }) }))
