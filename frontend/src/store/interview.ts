import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Patience } from '@/hooks/useEndOfTurn'
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
  /** Recording starts as soon as the interviewer finishes the question (real interview mode, when not hands-free). */
  autoRecord: boolean
  /**
   * Hands-free: the microphone opens after each question and closes when the learner pauses. In a real
   * interview the next question also comes at once, while the answer is scored in the background.
   */
  handsFree: boolean
  /** How long a pause ends an answer in hands-free mode. */
  patience: Patience
  /** Seconds to think before answering (practice mode). */
  thinkSeconds: number
  /** The job the learner is preparing for (optional): the interviewer words its questions for it. */
  company: string
  jobTitle: string
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
      handsFree: true,
      patience: 'normal',
      thinkSeconds: 0,
      company: '',
      jobTitle: '',
      set: (changes) => set(changes),
    }),
    { name: 'pc-interview', version: 1 },
  ),
)
