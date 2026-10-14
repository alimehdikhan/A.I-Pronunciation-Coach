import { useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { audioEngine } from '@/lib/audioEngine'

export interface TimedWord {
  index: number
  start: number | null
  end: number | null
}

/**
 * Plays a recording with word-level tracking. Playback position is exposed as
 * a motion value (no per-frame re-renders); the active word index only
 * triggers a render when it changes.
 */
export function usePlayback(url: string | null, words: TimedWord[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const segmentEnd = useRef<number | null>(null)
  const frame = useRef(0)
  const position = useMotionValue(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const wordsRef = useRef(words)

  useEffect(() => {
    wordsRef.current = words
  }, [words])

  useEffect(() => {
    if (!url) return
    const audio = new Audio(url)
    audio.preload = 'auto'
    audioRef.current = audio
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }
    const onEnded = () => {
      setPlaying(false)
      setActiveIndex(null)
      segmentEnd.current = null
    }
    // Paused elsewhere (e.g. the coach starts speaking): stop tracking.
    const onPause = () => {
      cancelAnimationFrame(frame.current)
      setPlaying(false)
    }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    return () => {
      cancelAnimationFrame(frame.current)
      audio.pause()
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audioRef.current = null
      setPlaying(false)
      setActiveIndex(null)
      position.set(0)
    }
  }, [url, position])

  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const t = audio.currentTime
    position.set(t)
    if (segmentEnd.current != null && t >= segmentEnd.current) {
      audio.pause()
      segmentEnd.current = null
      setPlaying(false)
      setActiveIndex(null)
      return
    }
    const current = wordsRef.current.find((w) => w.start != null && w.end != null && t >= w.start - 0.02 && t <= w.end + 0.04)
    setActiveIndex((prev) => (prev === (current?.index ?? null) ? prev : (current?.index ?? null)))
    frame.current = requestAnimationFrame(tick)
  }, [position])

  const play = useCallback(
    async (from?: number, until?: number) => {
      const audio = audioRef.current
      if (!audio) return
      if (from != null) audio.currentTime = Math.max(0, from)
      segmentEnd.current = until ?? null
      // Play through the shared Web Audio graph so the orb follows the recording.
      audioEngine.playMedia(audio, 'recording')
      try {
        await audio.play()
        setPlaying(true)
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(tick)
      } catch {
        setPlaying(false)
      }
    },
    [tick],
  )

  const pause = useCallback(() => {
    audioRef.current?.pause()
    cancelAnimationFrame(frame.current)
    segmentEnd.current = null
    setPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) pause()
    else void play(audio.ended || audio.currentTime >= (duration || Infinity) - 0.05 ? 0 : undefined)
  }, [duration, pause, play, playing])

  const seek = useCallback(
    (t: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = t
      position.set(t)
    },
    [position],
  )

  const playSegment = useCallback(
    (start: number, end: number) => void play(Math.max(0, start - 0.08), end + 0.12),
    [play],
  )

  return { playing, duration, position, activeIndex, play, pause, toggle, seek, playSegment }
}

export type Playback = ReturnType<typeof usePlayback>
