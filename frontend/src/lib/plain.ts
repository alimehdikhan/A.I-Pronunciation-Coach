import type { SoundMastery } from '@/lib/types'

/** "th as in think" -> { spelled: "th", word: "think" }. The symbol itself is never the headline. */
export function describeSound(sound: Pick<SoundMastery, 'label' | 'phoneme'>): { spelled: string; word: string } {
  const label = (sound.label || '').replace(/[\u201c\u201d"]/g, '')
  const [spelled, word] = label.split(/\s+as in\s+/i)
  return { spelled: spelled?.trim() || sound.phoneme, word: word?.trim() || '' }
}

/** The three scores, in the words a learner would use. */
export const SCORE_WORDS = {
  pronunciation: { label: 'Sounds', hint: 'How accurately you make each sound' },
  fluency: { label: 'Flow', hint: 'How smooth and steady your pace is' },
  clarity: { label: 'Clearness', hint: 'How easy you are to understand' },
} as const

export const STATUS_WORDS = {
  needs_work: 'Keep practising',
  getting_there: 'Getting there',
  solid: 'Got it',
  new: 'Just started',
} as const
