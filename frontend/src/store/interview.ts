import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InterviewType } from '@/lib/types'

/** "interview": a real interview, feedback at the end. "practice": feedback after every answer. */
export type InterviewMode = 'interview' | 'practice'

interface InterviewPrefs {
  type: InterviewType
  role: string
  level: string
  count: number
  mode: InterviewMode
  /** The interviewer reads each question aloud. */
  readAloud: boolean
  /** The interviewer speaks a quarter faster than the learner's usual voice speed, closer to real interviews. */
  fastSpeech: boolean
  /** The question is also shown as text (off is harder, like a phone call). */
  showText: boolean
  /** Recording starts as soon as the interviewer finishes the question (real interview mode). */
  autoRecord: boolean
  /** Seconds to think before answering (practice mode). */
  thinkSeconds: number
  set: (changes: Partial<Omit<InterviewPrefs, 'set'>>) => void
}

/** The learner's last mock-interview setup, kept in this browser. */
export const useInterviewPrefs = create<InterviewPrefs>()(
  persist(
    (set) => ({
      type: 'full',
      role: 'general',
      level: 'mid',
      count: 5,
      mode: 'interview',
      readAloud: true,
      fastSpeech: false,
      showText: true,
      autoRecord: true,
      thinkSeconds: 0,
      set: (changes) => set(changes),
    }),
    { name: 'pc-interview', version: 1 },
  ),
)
