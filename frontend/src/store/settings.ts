import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Level } from '@/lib/types'

export type Theme = 'dark' | 'light' | 'system'

/** A random per-browser secret that proves ownership of saved progress. */
export function newProfileKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface SettingsState {
  username: string
  theme: Theme
  voiceURI: string | null
  rate: number
  level: Level
  showIpa: boolean
  onboarded: boolean
  profileKey: string
  /** Set while this browser is signed in to an account. */
  accountEmail: string | null
  /** Shown instead of `username` while signed in (it may be shared with other people). */
  displayName: string
  /** The visitor has chosen "continue as a guest" on the entry screen. */
  guestChosen: boolean
  setUsername: (username: string) => void
  setTheme: (theme: Theme) => void
  setVoiceURI: (uri: string | null) => void
  setRate: (rate: number) => void
  setLevel: (level: Level) => void
  setShowIpa: (show: boolean) => void
  completeOnboarding: (username?: string) => void
  continueAsGuest: () => void
  /** Adopt the account's name after signing in or signing up. */
  signIn: (account: { username: string; displayName: string; email: string }) => void
  /** Leave the account on this browser and start a fresh guest profile. */
  signOut: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      username: '',
      theme: 'dark',
      voiceURI: null,
      rate: 0.95,
      level: 'beginner',
      showIpa: true,
      onboarded: false,
      profileKey: newProfileKey(),
      accountEmail: null,
      displayName: '',
      guestChosen: false,
      setUsername: (username) => set({ username: username.trim().slice(0, 40) }),
      setTheme: (theme) => set({ theme }),
      setVoiceURI: (voiceURI) => set({ voiceURI }),
      setRate: (rate) => set({ rate }),
      setLevel: (level) => set({ level }),
      setShowIpa: (showIpa) => set({ showIpa }),
      completeOnboarding: (username) =>
        set((s) => ({ onboarded: true, username: username !== undefined ? username.trim().slice(0, 40) : s.username })),
      continueAsGuest: () => set({ guestChosen: true }),
      signIn: ({ username, displayName, email }) =>
        set({ username, displayName, accountEmail: email, onboarded: true, guestChosen: true }),
      // A new key matters: the old one was just unbound server-side, and reusing
      // it would leave this browser looking like the account's owner.
      signOut: () => set({ username: '', displayName: '', accountEmail: null, profileKey: newProfileKey() }),
    }),
    {
      name: 'pc-settings',
      version: 3,
      migrate: (persisted, version) => {
        let state = (persisted ?? {}) as Partial<SettingsState>
        // v2 introduced the neural coach voice; move everyone onto it once.
        if (version < 2) state = { ...state, voiceURI: null }
        // v3 protects saved progress with a per-browser profile key.
        if (!state.profileKey) state = { ...state, profileKey: newProfileKey() }
        return state
      },
    },
  ),
)

export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#07070b' : '#f7f7fa')
}
