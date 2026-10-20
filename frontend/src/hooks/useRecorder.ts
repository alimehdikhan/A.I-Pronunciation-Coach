import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type RecorderState = 'idle' | 'requesting' | 'recording'

export interface Recording {
  blob: Blob
  filename: string
  duration: number
}

interface Options {
  maxSeconds?: number
  minSeconds?: number
  onRecorded: (recording: Recording) => void
  onError?: (message: string) => void
}

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/ogg']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export const recordingSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

/**
 * Microphone recorder with a live AnalyserNode for visualisation.
 * Stops automatically after `maxSeconds`.
 */
export function useRecorder({ maxSeconds = 30, minSeconds = 0.5, onRecorded, onError }: Options) {
  const [state, setRenderedState] = useState<RecorderState>('idle')
  // The same state, readable at once: a caller holding an older render's `start` still sees the truth.
  const stateRef = useRef<RecorderState>('idle')
  const setState = useCallback((next: RecorderState) => {
    stateRef.current = next
    setRenderedState(next)
  }, [])
  const [elapsed, setElapsed] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAt = useRef(0)
  const cancelled = useRef(false)
  const mounted = useRef(true)
  const callbacks = useRef({ onRecorded, onError })

  useEffect(() => {
    callbacks.current = { onRecorded, onError }
  }, [onRecorded, onError])

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    contextRef.current?.close().catch(() => undefined)
    contextRef.current = null
    analyserRef.current = null
    recorderRef.current = null
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    stop()
  }, [stop])

  const start = useCallback(async () => {
    if (recorderRef.current || stateRef.current !== 'idle') return
    if (!recordingSupported) {
      callbacks.current.onError?.('Recording is not supported in this browser. Try Chrome, Edge, Firefox or Safari.')
      return
    }
    cancelled.current = false
    setState('requesting')
    // Create the AudioContext inside the user's tap; one created after the
    // permission prompt can start suspended and the analyser would read silence.
    const context = new AudioContext()
    contextRef.current = context
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      streamRef.current = stream
      if (context.state === 'suspended') await context.resume().catch(() => undefined)

      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.55
      context.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser

      const mimeType = pickMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        const duration = (performance.now() - startedAt.current) / 1000
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type })
        cleanup()
        setState('idle')
        setElapsed(0)
        if (cancelled.current || !mounted.current) return
        if (duration < minSeconds || blob.size === 0) {
          callbacks.current.onError?.('That was a little short. Hold the recording for the whole phrase.')
          return
        }
        callbacks.current.onRecorded({ blob, filename: `recording.${extensionFor(type)}`, duration })
      }
      recorderRef.current = recorder
      recorder.start(250)
      startedAt.current = performance.now()
      timerRef.current = window.setInterval(() => {
        const seconds = (performance.now() - startedAt.current) / 1000
        setElapsed(seconds)
        if (seconds >= maxSeconds) stop()
      }, 100)
      setState('recording')
    } catch (error) {
      cleanup()
      setState('idle')
      const name = (error as DOMException)?.name
      callbacks.current.onError?.(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it from the address bar and try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Plug one in and try again.'
            : 'Could not start recording. Is another app using the microphone?',
      )
    }
  }, [cleanup, maxSeconds, minSeconds, setState, stop])

  const toggle = useCallback(() => {
    if (stateRef.current === 'recording') stop()
    else if (stateRef.current === 'idle') void start()
  }, [start, stop])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelled.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      cleanup()
    }
  }, [cleanup])

  return { state, elapsed, analyserRef: analyserRef as RefObject<AnalyserNode | null>, start, stop, cancel, toggle, maxSeconds }
}
