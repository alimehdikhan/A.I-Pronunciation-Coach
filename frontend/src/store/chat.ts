import { create } from 'zustand'
import type { ChatTurn } from '@/lib/types'

export interface ChatMessage extends ChatTurn {
  words?: string[]
  sentences?: { text: string; target_words: string[] }[]
  tryNext?: string | null
  offline?: boolean
}

interface ChatState {
  open: boolean
  messages: ChatMessage[]
  setOpen: (open: boolean) => void
  toggle: () => void
  add: (message: ChatMessage) => void
  clear: () => void
}

/** The coach chat for this visit. Kept in memory only: it is a conversation, not a record. */
export const useChat = create<ChatState>()((set) => ({
  open: false,
  messages: [],
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  add: (message) => set((s) => ({ messages: [...s.messages, message].slice(-40) })),
  clear: () => set({ messages: [] }),
}))
