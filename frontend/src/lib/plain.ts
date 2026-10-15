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

/** The kinds of sound, in everyday words. The technical term is kept as a hint only. */
export const GROUP_PLAIN: Record<string, { title: string; hint: string }> = {
  plosive: { title: 'Pop sounds', hint: 'Your lips or tongue block the air for a moment, then let it go.' },
  fricative: { title: 'Hiss and buzz sounds', hint: 'Air squeezes through a narrow gap and makes a hiss or a buzz.' },
  affricate: { title: 'Chop sounds', hint: 'A quick stop that slides straight into a hiss, like ch and j.' },
  nasal: { title: 'Nose sounds', hint: 'The air comes out through your nose.' },
  liquid: { title: 'Flowing sounds', hint: 'The air flows smoothly around your tongue, like l and r.' },
  glide: { title: 'Gliding sounds', hint: 'A quick slide into the next sound, like w and y.' },
  front: { title: 'Front vowels', hint: 'Your tongue is raised towards the front of your mouth.' },
  central: { title: 'Middle vowels', hint: 'Your tongue rests in the middle, relaxed.' },
  back: { title: 'Back vowels', hint: 'Your tongue is pulled back and your lips often round.' },
  'r-colored': { title: 'R-flavoured vowels', hint: 'Vowels shaded by the American r.' },
  diphthong: { title: 'Two-part vowels', hint: 'You glide from one vowel into another.' },
}

export const CATEGORY_PLAIN: Record<string, string> = {
  consonant: 'Consonant',
  vowel: 'Vowel',
  diphthong: 'Two-part vowel',
}

/** Whether the throat buzzes: the thing that tells "think" and "this" apart. */
export function voiceText(voiced: boolean): string {
  return voiced ? 'Throat buzzes' : 'Just air'
}
