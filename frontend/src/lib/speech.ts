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

const clampRate = (rate: number) => Math.min(1.6, Math.max(0.5, rate))

/** Browser speechSynthesis (fallback). Its audio can't be analysed. */
function speakWithBrowser(text: string, key: string, rate: number, voiceURI: string | null) {
  if (!supported) {
    useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
    return
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
  utterance.onend = utterance.onerror = () => {
    if (useVoiceStore.getState().speakingKey === key) {
      useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
    }
  }
  useVoiceStore.setState({ speakingKey: key, active: false, preparing: false })
  window.speechSynthesis.speak(utterance)
}

/**
 * Speak text with the user's voice settings. `speakingKey` identifies which
 * control started playback so it can show an active state.
 */
export function useSpeaker() {
  const voiceURI = useSettings((s) => s.voiceURI)
  const settingsRate = useSettings((s) => s.rate)
  const speakingKey = useVoiceStore((s) => s.speakingKey)
  const lastKey = useRef<string | null>(null)

  const stop = useCallback(() => audioEngine.stop(), [])

  const speak = useCallback(
    (text: string, opts: { key?: string; rate?: number } = {}) => {
      const clean = text.trim()
      if (!clean) return
      const key = opts.key ?? clean
      const rate = clampRate((opts.rate ?? 1) * settingsRate)
      lastKey.current = key
      if (usesNeuralVoice(voiceURI)) {
        audioEngine.speak(clean, { key, rate }).catch(() => {
          // Server voice unavailable: still speak, just without the analyser.
          if (lastKey.current === key) speakWithBrowser(clean, key, rate, voiceURI)
        })
      } else {
        audioEngine.stop()
        speakWithBrowser(clean, key, rate, voiceURI)
      }
    },
    [voiceURI, settingsRate],
  )

  // Stop speech this component started if it unmounts mid-sentence.
  useEffect(
    () => () => {
      if (lastKey.current && useVoiceStore.getState().speakingKey === lastKey.current) audioEngine.stop()
    },
    [],
  )

  return { speak, stop, speakingKey, supported: true }
}
