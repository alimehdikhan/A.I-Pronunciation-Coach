import type { RefObject } from 'react'
import type { AudioFrame } from '@/components/orb/SiriOrb'

// Voice energy lives mostly between ~80 Hz and ~4.5 kHz; split it into four bands.
const BAND_EDGES_HZ = [80, 250, 700, 1800, 4500]

/**
 * Returns a per-frame reader that turns a Web Audio AnalyserNode into the
 * orb's normalised `{ level, bands }`. Buffers are reused across calls.
 *
 * `gain` sets the soft-knee loudness curve (level = 1 - e^(-rms * gain)):
 * microphones are quieter than synthesized speech, so they get more gain.
 *
 * `adaptive` (microphones) also tracks the room's noise floor and the
 * speaker's recent peak, so a quiet microphone still drives the orb through
 * its full range instead of barely moving it.
 */
export const MIC_GAIN = 7
export const OUTPUT_GAIN = 4.5

// Below this span between noise floor and peak, the input is just noise.
const MIN_SPAN = 0.006
const MIN_BAND_SPAN = 0.12

export function createAnalyserReader(
  analyserRef: RefObject<AnalyserNode | null>,
  gain = MIC_GAIN,
  adaptive = false,
): () => AudioFrame | null {
  let time: Uint8Array<ArrayBuffer> | null = null
  let freq: Uint8Array<ArrayBuffer> | null = null
  let source: AnalyserNode | null = null
  const bands = [0, 0, 0, 0]
  let floor = 0
  let peak = 0
  const bandFloor = [0, 0, 0, 0]
  const bandPeak = [0, 0, 0, 0]

  return () => {
    const analyser = analyserRef.current
    if (!analyser) return null
    if (analyser !== source) {
      // New microphone session: forget the previous room and speaker.
      source = analyser
      floor = 0.002
      peak = 0.02
      bandFloor.fill(0.1)
      bandPeak.fill(0.4)
    }
    if (!time || time.length !== analyser.fftSize) time = new Uint8Array(analyser.fftSize)
    if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(time)
    analyser.getByteFrequencyData(freq)

    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / time.length)
    let level = 1 - Math.exp(-rms * gain)

    if (adaptive) {
      // Floor falls fast and rises slowly (~8 s); peak rises fast and decays (~2 s).
      floor += (rms - floor) * (rms < floor ? 0.3 : 0.002)
      peak = rms > peak ? peak + (rms - peak) * 0.5 : Math.max(floor, peak * 0.995)
      const x = Math.max(0, rms - floor * 1.5) / Math.max(MIN_SPAN, peak - floor)
      level = Math.max(level, 1 - Math.exp(-x * 2.4))
    }

    const binHz = analyser.context.sampleRate / 2 / freq.length
    for (let b = 0; b < 4; b++) {
      const start = Math.max(0, Math.floor(BAND_EDGES_HZ[b] / binHz))
      const end = Math.min(freq.length, Math.max(start + 1, Math.ceil(BAND_EDGES_HZ[b + 1] / binHz)))
      let total = 0
      for (let i = start; i < end; i++) total += freq[i]
      const value = total / (end - start) / 255
      if (adaptive) {
        bandFloor[b] += (value - bandFloor[b]) * (value < bandFloor[b] ? 0.3 : 0.002)
        bandPeak[b] = value > bandPeak[b] ? bandPeak[b] + (value - bandPeak[b]) * 0.5 : Math.max(bandFloor[b], bandPeak[b] * 0.996)
        const span = Math.max(MIN_BAND_SPAN, bandPeak[b] - bandFloor[b])
        bands[b] = Math.max(value, Math.min(1, Math.max(0, value - bandFloor[b]) / span))
      } else {
        bands[b] = value
      }
    }
    return { level, bands }
  }
}
