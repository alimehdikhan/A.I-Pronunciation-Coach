/**
 * The 3-second microphone check: from short frames of the signal, is the voice loud enough,
 * is it clipping, and how far above the room noise is it?
 *
 * Levels are measured after the browser's own processing (echo cancellation, noise
 * suppression, auto gain), because that is what a real recording gets.
 */

export type MicProblem = 'no_voice' | 'too_quiet' | 'clipping' | 'noisy'

export interface MicReport {
  /** Loudness of the voice (90th percentile of frame levels), dBFS. */
  speechDb: number
  /** Loudness of the quietest moments (10th percentile), dBFS: the room. */
  noiseDb: number
  /** speechDb - noiseDb. */
  snrDb: number
  /** Share of frames that hit full scale. */
  clipped: number
  problems: MicProblem[]
}

export interface Frame {
  rms: number
  peak: number
}

// The server can lift a quiet voice by up to 24 dB to its -20 dBFS target; quieter than this
// and the voice stays quiet next to any noise it lifts too.
const TOO_QUIET_DB = -42
const CLIPPING_SHARE = 0.01
const NOISY_SNR_DB = 15
const NO_VOICE_SNR_DB = 6

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-6))

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
}

/** Level and peak of one block of samples. */
export function measureFrame(samples: Float32Array): Frame {
  let sum = 0
  let peak = 0
  for (const x of samples) {
    sum += x * x
    peak = Math.max(peak, Math.abs(x))
  }
  return { rms: Math.sqrt(sum / Math.max(1, samples.length)), peak }
}

export function analyseMic(frames: Frame[]): MicReport {
  const levels = frames.map((f) => toDb(f.rms))
  const speechDb = levels.length ? percentile(levels, 0.9) : -120
  const noiseDb = levels.length ? percentile(levels, 0.1) : -120
  const snrDb = speechDb - noiseDb
  const clipped = frames.length ? frames.filter((f) => f.peak >= 0.99).length / frames.length : 0
  const problems: MicProblem[] = []
  if (snrDb < NO_VOICE_SNR_DB) problems.push('no_voice')
  else {
    if (speechDb < TOO_QUIET_DB) problems.push('too_quiet')
    if (snrDb < NOISY_SNR_DB) problems.push('noisy')
  }
  if (clipped > CLIPPING_SHARE) problems.push('clipping')
  return { speechDb, noiseDb, snrDb, clipped, problems }
}

export const MIC_ADVICE: Record<MicProblem, { title: string; fix: string }> = {
  no_voice: {
    title: 'We didn’t hear your voice',
    fix: 'Check that the right microphone is selected in your browser (the icon in the address bar) and not muted, then speak during the check.',
  },
  too_quiet: {
    title: 'Your voice is very quiet',
    fix: 'Move a hand’s width from the microphone, or raise the input volume in your computer’s sound settings.',
  },
  clipping: {
    title: 'Your voice is distorting',
    fix: 'You are too close or the input is too loud. Move back a little, or lower the input volume.',
  },
  noisy: {
    title: 'There’s a lot of background noise',
    fix: 'Find a quieter spot, turn off fans or music, or use a headset microphone. Noise can make clean sounds look like slips.',
  },
}

const CHECKED_KEY = 'pc-mic-checked'

/** Whether this browser tab already did (or skipped) the mic check. */
export function micChecked(): boolean {
  try {
    return sessionStorage.getItem(CHECKED_KEY) === '1'
  } catch {
    return true // no storage: never nag
  }
}

export function markMicChecked() {
  try {
    sessionStorage.setItem(CHECKED_KEY, '1')
  } catch {
    /* storage blocked */
  }
}
