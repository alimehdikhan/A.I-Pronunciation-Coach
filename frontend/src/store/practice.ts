import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { phrasesFor } from '@/lib/sentences'
import type { EvaluationResult } from '@/lib/types'

export type TargetSource = 'library' | 'custom' | 'drill' | 'word'

export interface Target {
  text: string
  source: TargetSource
  phraseId?: string
}

export interface Attempt {
  result: EvaluationResult
  audioUrl: string
  audioBlob: Blob
  createdAt: number
}

interface PracticeState {
  target: Target
  attempt: Attempt | null
  /** Recent scores for each phrase this session, newest last. */
  scoreHistory: Record<string, number[]>
  setTarget: (target: Target) => void
  setAttempt: (attempt: Attempt) => void
  clearAttempt: () => void
}

const first = phrasesFor('beginner')[1]

export const usePractice = create<PracticeState>()(
  persist(
    (set, get) => ({
      target: { text: first.text, source: 'library', phraseId: first.id },
      attempt: null,
      scoreHistory: {},
      setTarget: (target) => {
        const { attempt, target: current } = get()
        if (current.text === target.text && current.source === target.source) return
        if (attempt) URL.revokeObjectURL(attempt.audioUrl)
        set({ target, attempt: null })
      },
      setAttempt: (attempt) => {
        const { attempt: previous, scoreHistory, target } = get()
        if (previous) URL.revokeObjectURL(previous.audioUrl)
        const scores = [...(scoreHistory[target.text] ?? []), attempt.result.score].slice(-8)
        set({ attempt, scoreHistory: { ...scoreHistory, [target.text]: scores } })
      },
      clearAttempt: () => {
        const { attempt } = get()
        if (attempt) URL.revokeObjectURL(attempt.audioUrl)
        set({ attempt: null })
      },
    }),
    // Only the chosen phrase survives reloads; attempts hold blob URLs.
    { name: 'pc-practice', version: 1, partialize: (state) => ({ target: state.target }) },
  ),
)
