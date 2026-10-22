import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useSettings } from '@/store/settings'
import { audioEngine, useVoiceStore } from './audioEngine'

/**
 * The coach's voice. By default speech comes from the server's neural voice
 * and plays through the Web Audio engine (so the orb reacts to it); browser
 * speechSynthesis is used only when that is unavailable or explicitly chosen.
 */

/** Settings value meaning "use the neural server voice". */
export const NEURAL_VOICE = 'neural'

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

let cachedVoices: SpeechSynthesisVoice[] = []
const listeners = new Set<() => void>()

function refreshVoices() {
  if (!supported) return
  cachedVoices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  listeners.forEach((l) => l())
}

if (supported) {
  refreshVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVoices(): SpeechSynthesisVoice[] {
  return useSyncExternalStore(subscribe, () => cachedVoices, () => cachedVoices)
}

const QUALITY_HINTS = ['natural', 'neural', 'online', 'premium', 'enhanced', 'google us english', 'samantha', 'aria', 'jenny', 'ava', 'guy']

export function rankVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase()
  let rank = 0
  QUALITY_HINTS.forEach((hint, i) => {
    if (name.includes(hint)) rank += 40 - i
  })
  if (voice.lang === 'en-US') rank += 15
  else if (voice.lang.startsWith('en-GB')) rank += 8
  if (voice.localService === false) rank += 5
  return rank
}

export function pickVoice(voices: SpeechSynthesisVoice[], preferredURI?: string | null) {
  if (preferredURI && preferredURI !== NEURAL_VOICE) {
    const match = voices.find((v) => v.voiceURI === preferredURI)
    if (match) return match
  }
  return [...voices].sort((a, b) => rankVoice(b) - rankVoice(a))[0]
}

export const ttsSupported = true

export function usesNeuralVoice(voiceURI: string | null): boolean {
  return !voiceURI || voiceURI === NEURAL_VOICE
}

/** Speed of the "Slowly" button, relative to the learner's speed setting (scripts/prerender_voice.py matches it). */
export const SLOW_RATE = 0.7

const clampRate = (rate: number) => Math.min(1.6, Math.max(0.5, rate))

/** The neural voice reads at most this many characters per request (the server allows 300). */
const MAX_SPOKEN = 280

function packWords(sentence: string, max: number): string[] {
  const out: string[] = []
  let current = ''
  for (const word of sentence.split(/\s+/)) {
    if (current && current.length + 1 + word.length > max) {
      out.push(current)
      current = word
    } else current = current ? `${current} ${word}` : word
  }
  if (current) out.push(current)
  return out
}

/**
 * Text as sentences, each short enough for one request to the voice. One sentence renders much faster
 * than a paragraph, so the first can play while the next is still being rendered.
 */
export function splitForSpeech(text: string, max = MAX_SPOKEN): string[] {
  // A sentence ends at . ! or ? followed by a space and a capital or a digit, so "3.5 years" and "e.g. this" stay whole.
  const sentences: string[] = []
  let start = 0
  for (const end of text.matchAll(/[.!?]+["”’)\]]*\s+(?=["“‘(]?[A-Z0-9])/g)) {
    const stop = end.index + end[0].length
    sentences.push(text.slice(start, stop).trim())
    start = stop
  }
  sentences.push(text.slice(start).trim())
  return sentences.filter(Boolean).flatMap((sentence) => (sentence.length > max ? packWords(sentence, max) : [sentence]))
}

/** Render pieces one after another, in speaking order: the server renders one clip at a time. */
function renderInOrder(chunks: string[], rate: number, voice: string, once: boolean): Promise<void> {
  return chunks.reduce<Promise<void>>((ready, chunk) => ready.then(() => audioEngine.prefetch(chunk, rate, voice, once)), Promise.resolve())
}

/** Browser speechSynthesis (fallback). Its audio can't be analysed. Resolves true when it was all said. */
function speakWithBrowser(text: string, key: string, rate: number, voiceURI: string | null): Promise<boolean> {
  if (!supported) {
    useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
    return Promise.resolve(false)
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(cachedVoices, voiceURI)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else {
    utterance.lang = 'en-US'
  }
  utterance.rate = Math.min(1.5, Math.max(0.4, rate))
  return new Promise((resolve) => {
    const settle = (completed: boolean) => () => {
      if (useVoiceStore.getState().speakingKey === key) {
        useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
      }
      resolve(completed)
    }
    utterance.onend = settle(true)
    utterance.onerror = settle(false)
    useVoiceStore.setState({ speakingKey: key, active: false, preparing: false })
    window.speechSynthesis.speak(utterance)
  })
}

/**
 * Speak text with the user's voice settings. `speakingKey` identifies which
 * control started playback so it can show an active state. `once`: one-off text (the
 * learner's own words, a live reply), which the server never stores.
 */
export function useSpeaker() {
  const voiceURI = useSettings((s) => s.voiceURI)
  // A British target speaks with the British voice unless the learner picked one themselves.
  const coachVoice = useSettings((s) => s.coachVoice ?? (s.accent === 'british' ? 'bf_emma' : null)) ?? ''
  const settingsRate = useSettings((s) => s.rate)
  const speakingKey = useVoiceStore((s) => s.speakingKey)
  const lastKey = useRef<string | null>(null)

  const stop = useCallback(() => audioEngine.stop(), [])

  const speak = useCallback(
    (text: string, opts: { key?: string; rate?: number; once?: boolean } = {}) => {
      const clean = text.trim()
      if (!clean) return
      const key = opts.key ?? clean
      const rate = clampRate((opts.rate ?? 1) * settingsRate)
      lastKey.current = key
      if (usesNeuralVoice(voiceURI)) {
        audioEngine.speak(clean, { key, rate, voice: coachVoice, once: opts.once }).catch(() => {
          // Server voice unavailable: still speak, just without the analyser.
          if (lastKey.current === key) void speakWithBrowser(clean, key, rate, voiceURI)
        })
      } else {
        audioEngine.stop()
        void speakWithBrowser(clean, key, rate, voiceURI)
      }
    },
    [voiceURI, settingsRate, coachVoice],
  )

  /**
   * Speak and wait. Text of any length (long text is read in sentence-sized pieces).
   * Resolves true when everything was said, false when it was cut off: stopped, or
   * another control started speaking.
   */
  const say = useCallback(
    async (text: string, opts: { key?: string; rate?: number; voice?: string; once?: boolean } = {}): Promise<boolean> => {
      const clean = text.trim()
      if (!clean) return true
      const key = opts.key ?? clean
      const rate = clampRate((opts.rate ?? 1) * settingsRate)
      // Another person in the room (a group discussion) speaks with their own neural voice.
      const voice = opts.voice ?? coachVoice
      const once = opts.once ?? false
      lastKey.current = key
      if (usesNeuralVoice(voiceURI)) {
        const chunks = splitForSpeech(clean)
        // The first piece is requested by `speak` straight away; the rest follow it in order.
        void renderInOrder(chunks, rate, voice, once)
        try {
          for (const chunk of chunks) {
            if (!(await audioEngine.speak(chunk, { key, rate, voice, once }))) return false
          }
          return true
        } catch {
          // Server voice unavailable: the browser's voice says it instead.
          if (lastKey.current !== key) return false
        }
      } else {
        audioEngine.stop()
      }
      return speakWithBrowser(clean, key, rate, voiceURI)
    },
    [voiceURI, settingsRate, coachVoice],
  )

  /**
   * Start fetching a clip before it is asked for, so the click that follows plays at once. `voice` overrides the
   * coach voice; `once` marks one-off text, which the server never stores.
   */
  const prefetch = useCallback(
    (text: string, rate = 1, voice?: string, once = false): Promise<void> => {
      const clean = text.trim()
      if (!clean || !usesNeuralVoice(voiceURI)) return Promise.resolve()
      return renderInOrder(splitForSpeech(clean), clampRate(rate * settingsRate), voice ?? coachVoice, once)
    },
    [voiceURI, settingsRate, coachVoice],
  )

  // Stop speech this component started if it unmounts mid-sentence.
  useEffect(
    () => () => {
      if (lastKey.current && useVoiceStore.getState().speakingKey === lastKey.current) audioEngine.stop()
    },
    [],
  )

  return { speak, say, stop, prefetch, speakingKey, supported: true }
}
