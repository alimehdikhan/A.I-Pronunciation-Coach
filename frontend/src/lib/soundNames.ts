import { useCallback } from 'react'
import { describeSound } from '@/lib/plain'
import { usePhonemes } from '@/lib/queries'

export interface SoundName {
  /** How the sound is spelled: "th", "sh", "ng". */
  spelled: string
  /** An example word: "think". */
  word: string
  /** "th as in think". */
  text: string
}

/**
 * Names for sounds, from the sound library. `name("θ")` gives `{ spelled: "th", word: "think", text: "th as in think" }`.
 * Before the library has loaded (or for a symbol it does not know) it returns the symbol, so nothing goes blank.
 */
export function useSoundName(): (symbol: string) => SoundName {
  const { data } = usePhonemes()
  return useCallback(
    (symbol: string) => {
      const entry = data?.find((p) => p.symbol === symbol)
      if (!entry) return { spelled: symbol, word: '', text: symbol }
      const { spelled, word } = describeSound({ label: entry.label, phoneme: symbol })
      return { spelled, word, text: word ? `${spelled} as in ${word}` : spelled }
    },
    [data],
  )
}
