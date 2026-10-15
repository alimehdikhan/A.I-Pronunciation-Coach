/**
 * The live voice conversation, from the browser's side.
 *
 *   microphone --(16 kHz PCM)--> WebSocket --> server --> Gemini Live
 *   speakers  <--(24 kHz PCM)--  WebSocket <-- server <-- Gemini Live
 *
 * The server holds the Gemini key; this class only ever talks to our own `/ws/voice`.
 */

export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'thinking' | 'ended' | 'error'

export interface VoiceHint {
  word: string
  heard: string
  score: number
}

export interface VoiceHandlers {
  onState: (state: VoiceState) => void
  onTranscript: (role: 'learner' | 'coach', text: string) => void
  onHint: (hint: VoiceHint) => void
  onGuard: () => void
  onError: (message: string, code?: string) => void
}

export interface VoiceOptions {
  username: string
  profileKey: string
  level: string
  nativeLanguage: string | null
  voice: string
}

const CAPTURE_RATE = 16000
const PLAYBACK_RATE = 24000
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

// Runs on the audio thread: averages the microphone down to 16 kHz and hands over 100 ms of 16-bit PCM at a time.
const CAPTURE_WORKLET = `
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / ${CAPTURE_RATE}
    this.phase = 0
    this.sum = 0
    this.count = 0
    this.out = new Int16Array(${CAPTURE_RATE / 10})
    this.n = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i]
      this.count++
      this.phase += 1
      if (this.phase >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.sum / this.count))
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
        this.sum = 0
        this.count = 0
        this.phase -= this.ratio
        if (this.n === this.out.length) {
          const chunk = this.out.slice(0)
          this.port.postMessage(chunk.buffer, [chunk.buffer])
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('pcm16-capture', Pcm16Capture)
`

export function voiceSocketUrl(): string {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws/voice'
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`
}

export class VoiceClient {
  private socket: WebSocket | null = null
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private capture: AudioWorkletNode | null = null
  private output: GainNode | null = null
  private outAnalyser: AnalyserNode | null = null
  private inAnalyser: AnalyserNode | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private nextTime = 0
  private muted = false
  private closed = false
  private frame = new Uint8Array(512)

  constructor(
    private readonly options: VoiceOptions,
    private readonly on: VoiceHandlers,
  ) {}

  /** Must be called from a click: browsers only allow the microphone and audio after a gesture. */
  async start(): Promise<void> {
    this.on.onState('connecting')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
    } catch {
      this.fail('The microphone is blocked. Allow it in your browser and try again.', 'microphone')
      return
    }
    const context = new AudioContext()
    this.context = context
    await context.resume().catch(() => undefined)

    this.output = context.createGain()
    this.outAnalyser = context.createAnalyser()
    this.outAnalyser.fftSize = 512
    this.output.connect(this.outAnalyser)
    this.outAnalyser.connect(context.destination)

    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }))
    try {
      await context.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const source = context.createMediaStreamSource(this.stream)
    this.inAnalyser = context.createAnalyser()
    this.inAnalyser.fftSize = 512
    source.connect(this.inAnalyser)
    this.capture = new AudioWorkletNode(context, 'pcm16-capture')
    source.connect(this.capture)
    // Chrome runs an unconnected worklet; Firefox and Safari do not. A muted output keeps it running everywhere
    // without playing the microphone back through the speakers.
    const silent = context.createGain()
    silent.gain.value = 0
    this.capture.connect(silent)
    silent.connect(context.destination)
    this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.muted && this.socket?.readyState === WebSocket.OPEN) this.socket.send(event.data)
    }

    const socket = new WebSocket(voiceSocketUrl())
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: 'start',
          username: this.options.username,
          profile_key: this.options.profileKey,
          level: this.options.level,
          native_language: this.options.nativeLanguage,
          voice: this.options.voice,
        }),
      )
    socket.onmessage = (event) => this.handle(event.data)
    socket.onerror = () => this.fail('Could not reach the coach. Please try again.', 'network')
    socket.onclose = () => {
      if (!this.closed) {
        this.closed = true
        this.teardown()
        this.on.onState('ended')
      }
    }
  }

  private handle(data: ArrayBuffer | string): void {
    if (typeof data !== 'string') {
      this.play(data)
      return
    }
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    switch (message.type) {
      case 'ready':
        this.on.onState('listening')
        break
      case 'transcript':
        this.on.onTranscript(message.role as 'learner' | 'coach', String(message.text ?? ''))
        if (message.role === 'learner') this.on.onState('thinking')
        break
      case 'interrupted':
        this.stopPlayback()
        this.on.onState('listening')
        break
      case 'turn_complete':
        if (this.sources.size === 0) this.on.onState('listening')
        break
      case 'hint':
        this.on.onHint({ word: String(message.word), heard: String(message.heard ?? ''), score: Number(message.score ?? 0) })
        break
      case 'guard':
        this.on.onGuard()
        break
      case 'error':
        this.fail(String(message.message ?? 'Something went wrong.'), String(message.code ?? ''))
        break
      case 'closed':
        this.stop()
        break
    }
  }

  /** Schedule one chunk of 24 kHz PCM straight after the previous one, so speech plays without gaps. */
  private play(buffer: ArrayBuffer): void {
    const context = this.context
    if (!context || !this.output) return
    const pcm = new Int16Array(buffer)
    if (pcm.length === 0) return
    const audio = context.createBuffer(1, pcm.length, PLAYBACK_RATE)
    const channel = audio.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768
    const source = context.createBufferSource()
    source.buffer = audio
    source.connect(this.output)
    const startAt = Math.max(context.currentTime + 0.02, this.nextTime)
    source.start(startAt)
    this.nextTime = startAt + audio.duration
    this.sources.add(source)
    this.on.onState('speaking')
    source.onended = () => {
      this.sources.delete(source)
      if (this.sources.size === 0 && !this.closed) this.on.onState('listening')
    }
  }

  private stopPlayback(): void {
    for (const source of this.sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already finished */
      }
    }
    this.sources.clear()
    this.nextTime = 0
  }

  private level(analyser: AnalyserNode | null): number {
    if (!analyser) return 0
    analyser.getByteTimeDomainData(this.frame)
    let sum = 0
    for (let i = 0; i < this.frame.length; i++) {
      const v = (this.frame[i] - 128) / 128
      sum += v * v
    }
    return Math.min(1, Math.sqrt(sum / this.frame.length) * 3.2)
  }

  /** What the orb should show right now: the coach's voice while it speaks, the learner's otherwise. */
  audioLevel(speaking: boolean): number {
    return this.level(speaking ? this.outAnalyser : this.inAnalyser)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  private fail(message: string, code?: string): void {
    if (this.closed) return
    this.closed = true
    this.teardown()
    this.on.onError(message, code)
    this.on.onState('error')
  }

  /** End the conversation. */
  stop(): void {
    if (this.closed) return
    this.closed = true
    try {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'end' }))
    } catch {
      /* the connection is going away anyway */
    }
    this.teardown()
    this.on.onState('ended')
  }

  private teardown(): void {
    this.stopPlayback()
    this.capture?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.socket?.close()
    void this.context?.close().catch(() => undefined)
    this.capture = null
    this.stream = null
    this.socket = null
    this.context = null
  }
}
