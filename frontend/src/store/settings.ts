import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Level } from '@/lib/types'

export type Theme = 'dark' | 'light' | 'system'

/** A random per-browser secret that proves ownership of saved progress. */
export function newProfileKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type Goal = 'understood' | 'accent'
export type Accent = 'american' | 'british'
export type TipLanguage = 'English' | 'Hindi' | 'Urdu' | 'Hinglish'

interface SettingsState {
  username: string
  theme: Theme
  voiceURI: string | null
  /** Attempts to aim for each day: 3, 5 or 10. */
  dailyGoal: number
  /** The learner's first language, so the coach can say what is typically hard for them. Stays in this browser. */
  nativeLanguage: string | null
  /** Careful (slow) speech is shown but not counted toward mastery, streaks or the daily goal. */
  naturalSpeed: boolean
  /** 'understood': slips that change what a listener understands come first; 'accent': every slip. */
  goal: Goal
  /** Experimental: check which syllable of each long word was stressed. */
  stressCheck: boolean
  /** The English the coach aims for: American (default) or British (non-rhotic forms accepted, British IPA and voice). */
  accent: Accent
  /** The language coaching tips are written in. */
  tipLanguage: TipLanguage
  /** Which neural voice the server speaks with; null is the server's default. */
  coachVoice: string | null
  rate: number
  level: Level
  showIpa: boolean
  /** What to show under each word: plain letters ("uh-BOWT"), IPA symbols, or nothing. */
  phoneticStyle: 'simple' | 'ipa' | 'off'
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
  setDailyGoal: (goal: number) => void
  setNativeLanguage: (language: string | null) => void
  setNaturalSpeed: (on: boolean) => void
  setGoal: (goal: Goal) => void
  setStressCheck: (on: boolean) => void
  setAccent: (accent: Accent) => void
  setTipLanguage: (language: TipLanguage) => void
  setCoachVoice: (voice: string | null) => void
  setRate: (rate: number) => void
  setLevel: (level: Level) => void
  setShowIpa: (show: boolean) => void
  setPhoneticStyle: (style: 'simple' | 'ipa' | 'off') => void
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
      dailyGoal: 5,
      naturalSpeed: false,
      goal: 'understood',
      stressCheck: false,
      accent: 'american',
      tipLanguage: 'English',
      nativeLanguage: null,
      coachVoice: null,
      rate: 0.95,
      level: 'beginner',
      showIpa: true,
      phoneticStyle: 'simple',
      onboarded: false,
      profileKey: newProfileKey(),
      accountEmail: null,
      displayName: '',
      guestChosen: false,
      setUsername: (username) => set({ username: username.trim().slice(0, 40) }),
      setTheme: (theme) => set({ theme }),
      setVoiceURI: (voiceURI) => set({ voiceURI }),
      setDailyGoal: (dailyGoal) => set({ dailyGoal }),
      setNaturalSpeed: (naturalSpeed) => set({ naturalSpeed }),
      setGoal: (goal) => set({ goal }),
      setStressCheck: (stressCheck) => set({ stressCheck }),
      setAccent: (accent) => set({ accent }),
      setTipLanguage: (tipLanguage) => set({ tipLanguage }),
      setNativeLanguage: (nativeLanguage) => set({ nativeLanguage }),
      setCoachVoice: (coachVoice) => set({ coachVoice }),
      setRate: (rate) => set({ rate }),
      setLevel: (level) => set({ level }),
      setShowIpa: (showIpa) => set({ showIpa }),
      setPhoneticStyle: (phoneticStyle) => set({ phoneticStyle }),
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
      version: 4,
      migrate: (persisted, version) => {
        let state = (persisted ?? {}) as Partial<SettingsState>
        // v2 introduced the neural coach voice; move everyone onto it once.
        if (version < 2) state = { ...state, voiceURI: null }
        // v4 shows plain-letter pronunciations by default; anyone who had turned the line off keeps it off.
        if (version < 4) state = { ...state, phoneticStyle: state.showIpa === false ? 'off' : 'simple' }
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
