import { useEffect, useState } from 'react'

/** Decode an audio blob and reduce it to `bars` normalised peak values. */
export function useAudioPeaks(blob: Blob | null | undefined, bars = 140) {
  const [data, setData] = useState<{ peaks: number[]; duration: number } | null>(null)

  useEffect(() => {
    if (!blob) {
      setData(null)
      return
    }
    let cancelled = false
    const context = new AudioContext()
    blob
      .arrayBuffer()
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audio) => {
        if (cancelled) return
        const channel = audio.getChannelData(0)
        const size = Math.max(1, Math.floor(channel.length / bars))
        const peaks: number[] = []
        for (let i = 0; i < bars; i++) {
          let sum = 0
          const start = i * size
          for (let j = 0; j < size && start + j < channel.length; j++) sum += channel[start + j] ** 2
          peaks.push(Math.sqrt(sum / size))
        }
        const max = Math.max(...peaks, 1e-4)
        setData({ peaks: peaks.map((p) => Math.pow(p / max, 0.7)), duration: audio.duration })
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => context.close().catch(() => undefined))
    return () => {
      cancelled = true
    }
  }, [blob, bars])

  return data
}
