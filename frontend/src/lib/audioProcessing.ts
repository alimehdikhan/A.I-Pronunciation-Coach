/**
 * Prepares a recording before it is scored and played back.
 *
 * Microphone levels vary a lot between devices, and quiet input both hurts
 * Whisper's accuracy and is hard to hear on playback. This decodes the clip to
 * 16 kHz mono (what Whisper consumes, so the server can skip ffmpeg), measures
 * the speech level while ignoring silence, applies make-up gain with a soft
 * limiter, and encodes the result as 16-bit WAV.
 */

const RATE = 16_000
const TARGET_SPEECH_RMS = 0.1 // ≈ -20 dBFS, a comfortable speech level
const MAX_GAIN = 16 // +24 dB
const KNEE = 0.9
const MAX_SECONDS = 60
const FRAME = RATE / 50 // 20 ms

export interface PreparedRecording {
  /** The levelled clip (16 kHz WAV), for playback. */
  blob: Blob
  filename: string
  gainDb: number
  /** What is sent to the server: the levelled WAV, or the compressed recording when it is long (see UPLOAD_AS_RECORDED_FROM). */
  upload: Blob
  uploadName: string
}

/**
 * From this length a recording is uploaded as the browser recorded it (Opus or AAC, about half the size of
 * the WAV) and the server levels it: a minute of speech is 1 MB instead of 1.9 MB, and a mock interview
 * sends each answer twice. Shorter clips go as WAV, which the server reads without ffmpeg.
 */
const UPLOAD_AS_RECORDED_FROM = 10
const COMPRESSED = /^(audio|video)\/(webm|ogg|mp4|aac|mpeg|x-m4a)/

// One recording is often sent twice (a mock interview answer goes to the interviewer and to scoring):
// it is decoded and encoded once, and the second send reuses the result.
const prepared = new WeakMap<Blob, Map<string, Promise<PreparedRecording>>>()

export function prepareRecording(blob: Blob, filename: string): Promise<PreparedRecording> {
  let byName = prepared.get(blob)
  if (!byName) prepared.set(blob, (byName = new Map()))
  let result = byName.get(filename)
  if (!result) byName.set(filename, (result = prepare(blob, filename)))
  return result
}

async function prepare(blob: Blob, filename: string): Promise<PreparedRecording> {
  try {
    const samples = await decodeMono16k(blob)
    if (samples.length < FRAME * 5 || samples.length > RATE * MAX_SECONDS) return asRecorded(blob, filename)
    const gain = normalize(samples)
    const wav = encodeWav(samples, RATE)
    const wavName = `${filename.replace(/\.[^.]*$/, '') || 'recording'}.wav`
    const long = samples.length >= RATE * UPLOAD_AS_RECORDED_FROM && COMPRESSED.test(blob.type)
    return {
      blob: wav,
      filename: wavName,
      gainDb: Math.round(20 * Math.log10(gain) * 10) / 10,
      upload: long ? blob : wav,
      uploadName: long ? filename : wavName,
    }
  } catch {
    // Undecodable here (rare codec): the server decodes and normalises it instead.
    return asRecorded(blob, filename)
  }
}

const asRecorded = (blob: Blob, filename: string): PreparedRecording => ({ blob, filename, gainDb: 0, upload: blob, uploadName: filename })

async function decodeMono16k(blob: Blob): Promise<Float32Array> {
  // An offline context at 16 kHz makes the browser's decoder resample for us.
  const context = new OfflineAudioContext(1, 1, RATE)
  const buffer = await context.decodeAudioData(await blob.arrayBuffer())
  const out = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels
  }
  return out
}

/** Normalises speech loudness in place and returns the linear gain applied. */
function normalize(samples: Float32Array): number {
  let mean = 0
  for (let i = 0; i < samples.length; i++) mean += samples[i]
  mean /= samples.length

  const frames = Math.floor(samples.length / FRAME)
  const levels = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
      const v = samples[i] - mean
      sum += v * v
    }
    levels[f] = Math.sqrt(sum / FRAME)
  }
  levels.sort()
  // Loud frames are speech; short words in long clips are covered by the peak term.
  const speech = Math.max(levels[Math.floor((frames - 1) * 0.95)], levels[frames - 1] / 3)
  const gain = speech > 1e-5 ? Math.min(MAX_GAIN, Math.max(1, TARGET_SPEECH_RMS / speech)) : 1

  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - mean) * gain
    const a = Math.abs(v)
    samples[i] = a <= KNEE ? v : Math.sign(v) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)))
  }
  return gain
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const header = new DataView(new ArrayBuffer(44))
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  header.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, rate, true)
  header.setUint32(28, rate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  ascii(36, 'data')
  header.setUint32(40, samples.length * 2, true)

  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return new Blob([header.buffer, pcm.buffer], { type: 'audio/wav' })
}
