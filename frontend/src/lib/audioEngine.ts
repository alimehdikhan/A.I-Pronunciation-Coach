import { create } from 'zustand'

/**
 * One Web Audio graph for everything the coach plays: neural speech from
 * /api/tts and playback of the user's recordings. All of it flows through a
 * shared AnalyserNode, so the orb can react to the real output signal.
 *
 *   source ─▶ output gain ─▶ analyser ─▶ speakers
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const MAX_CACHED = 48

interface VoiceState {
  /** Which control started the current playback (for button states). */
  speakingKey: string | null
  /** True while real audio is flowing through the analyser. */
  active: boolean
  /** True while speech is being fetched/decoded before it starts. */
  preparing: boolean
}

export const useVoiceStore = create<VoiceState>()(() => ({ speakingKey: null, active: false, preparing: false }))

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX_CACHED) map.delete(map.keys().next().value as K)
}

class AudioEngine {
  private context: AudioContext | null = null
  private output: GainNode | null = null
  private analyserNode: AnalyserNode | null = null
  private source: AudioBufferSourceNode | null = null
  private media: HTMLMediaElement | null = null
  private mediaNodes = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  private raw = new Map<string, Promise<ArrayBuffer>>()
  private decoded = new Map<string, AudioBuffer>()
  private token = 0

  /** The shared output analyser (null until the first playback). */
  get analyser(): AnalyserNode | null {
    return this.analyserNode
  }

  /** Create or resume the context. Call synchronously inside a user gesture. */
  ensure(): AudioContext {
    if (!this.context) {
      const context = new AudioContext()
      const output = context.createGain()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.55
      output.connect(analyser)
      analyser.connect(context.destination)
      this.context = context
      this.output = output
      this.analyserNode = analyser
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined)
    return this.context
  }

  private cacheKey(text: string, rate: number, voice = '') {
    return `${voice}|${rate.toFixed(2)}|${text}`
  }

  /** Fetch (and cache) neural speech audio for `text`. */
  fetchSpeech(text: string, rate = 1, voice = ''): Promise<ArrayBuffer> {
    const key = this.cacheKey(text, rate, voice)
    let pending = this.raw.get(key)
    if (!pending) {
      const choice = voice ? `&voice=${encodeURIComponent(voice)}` : ''
      pending = fetch(`${BASE}/api/tts?text=${encodeURIComponent(text)}&rate=${rate.toFixed(2)}${choice}`).then((response) => {
        if (!response.ok) throw new Error(`Speech unavailable (${response.status})`)
        return response.arrayBuffer()
      })
      pending.catch(() => this.raw.delete(key))
      remember(this.raw, key, pending)
    }
    return pending
  }

  /** Warm the cache so a later `speak` starts instantly. */
  prefetch(text: string, rate = 1, voice = '') {
    void this.fetchSpeech(text, rate, voice).catch(() => undefined)
  }

  /**
   * Speak `text` with the neural voice through the analyser. Resolves when the
   * audio finishes (or is interrupted); rejects if speech is unavailable so the
   * caller can fall back.
   */
  async speak(text: string, { key, rate = 1, voice = '' }: { key: string; rate?: number; voice?: string }): Promise<void> {
    const context = this.ensure()
    this.stop()
    const token = ++this.token
    useVoiceStore.setState({ speakingKey: key, active: false, preparing: true })

    try {
      const cacheKey = this.cacheKey(text, rate, voice)
      let buffer = this.decoded.get(cacheKey)
      if (!buffer) {
        const bytes = await this.fetchSpeech(text, rate, voice)
        buffer = await context.decodeAudioData(bytes.slice(0))
        remember(this.decoded, cacheKey, buffer)
      }
      if (token !== this.token) return

      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(this.output!)
      this.source = source
      const finished = new Promise<void>((resolve) => {
        source.onended = () => {
          if (this.source === source) {
            this.source = null
            useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
          }
          resolve()
        }
      })
      source.start()
      useVoiceStore.setState({ speakingKey: key, active: true, preparing: false })
      await finished
    } catch (error) {
      if (token === this.token) useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
      throw error
    }
  }

  /**
   * Route a media element (e.g. the user's recording) through the analyser and
   * mark the engine active while it plays. Call from the click that starts it.
   */
  playMedia(element: HTMLMediaElement, key: string) {
    const context = this.ensure()
    if (!this.mediaNodes.has(element)) {
      const node = context.createMediaElementSource(element)
      node.connect(this.output!)
      this.mediaNodes.set(element, node)
      const settle = () => {
        if (this.media === element) {
          this.media = null
          useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
        }
      }
      element.addEventListener('pause', settle)
      element.addEventListener('ended', settle)
    }
    if (this.media !== element || this.source) this.stop()
    this.media = element
    useVoiceStore.setState({ speakingKey: key, active: true, preparing: false })
  }

  /** Stop whatever is playing (speech, recording playback, browser fallback). */
  stop() {
    this.token++
    if (this.source) {
      const source = this.source
      this.source = null
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
    }
    if (this.media) {
      const media = this.media
      this.media = null
      media.pause()
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    useVoiceStore.setState({ speakingKey: null, active: false, preparing: false })
  }
}

export const audioEngine = new AudioEngine()

/** A ref-like view of the output analyser for per-frame readers. */
export const outputAnalyserRef = {
  get current() {
    return audioEngine.analyser
  },
}
