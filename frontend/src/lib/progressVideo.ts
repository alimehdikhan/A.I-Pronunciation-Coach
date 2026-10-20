/**
 * "Day 1 vs Day 30" as a short vertical video, made entirely in the browser: both recordings play
 * through a Web Audio graph while a canvas draws the captions, a live waveform and the numbers;
 * MediaRecorder captures the two together. Nothing is uploaded.
 */

import type { Day30Change, Day30Round } from './types'

const WIDTH = 720
const HEIGHT = 1280
const FPS = 30
const INTRO = 2.6
const GAP = 1.2
const OUTRO = 4.5
const FONT = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

const TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function videoSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype &&
    TYPES.some((type) => MediaRecorder.isTypeSupported(type))
  )
}

export interface VideoInput {
  question: string
  first: { round: Day30Round; audio: Blob; label: string }
  latest: { round: Day30Round; audio: Blob; label: string }
  changes: { label: string; change: Day30Change; unit: string }[]
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function background(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  sky.addColorStop(0, '#101016')
  sky.addColorStop(1, '#050507')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const glow = ctx.createRadialGradient(WIDTH / 2, -120, 40, WIDTH / 2, -120, 760)
  glow.addColorStop(0, 'rgba(10,132,255,0.35)')
  glow.addColorStop(0.5, 'rgba(201,89,221,0.12)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

function brand(ctx: CanvasRenderingContext2D) {
  const mark = ctx.createLinearGradient(56, 64, 96, 104)
  mark.addColorStop(0, '#0894ff')
  mark.addColorStop(0.5, '#c959dd')
  mark.addColorStop(1, '#ff2e54')
  ctx.fillStyle = mark
  ctx.beginPath()
  ctx.roundRect(56, 64, 40, 40, 11)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = `600 24px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillText('AI Pronunciation Coach', 110, 85)
}

function centred(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, colour: string, maxWidth = WIDTH - 112) {
  ctx.font = font
  ctx.fillStyle = colour
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const lines = wrap(ctx, text, maxWidth)
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 32)
  lines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, y + i * size * 1.22))
  ctx.textAlign = 'left'
  return y + lines.length * size * 1.22
}

function waveform(ctx: CanvasRenderingContext2D, levels: Uint8Array, y: number, colours: [string, string]) {
  const bars = 40
  const gap = 6
  const barWidth = (WIDTH - 112 - gap * (bars - 1)) / bars
  const fill = ctx.createLinearGradient(56, 0, WIDTH - 56, 0)
  fill.addColorStop(0, colours[0])
  fill.addColorStop(1, colours[1])
  ctx.fillStyle = fill
  // Symmetric from the centre, from the low bins where speech lives, so the whole width moves with the voice.
  const half = bars / 2
  for (let i = 0; i < bars; i++) {
    const distance = Math.abs(i + 0.5 - half) / half
    const value = levels[Math.floor(distance * levels.length * 0.35)] / 255
    const h = 10 + value * 220
    ctx.beginPath()
    ctx.roundRect(56 + i * (barWidth + gap), y - h / 2, barWidth, h, barWidth / 2)
    ctx.fill()
  }
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string) {
  ctx.font = `500 22px ${FONT}`
  const labelWidth = ctx.measureText(label).width
  ctx.font = `700 26px ${FONT}`
  const valueWidth = ctx.measureText(value).width
  const width = labelWidth + valueWidth + 52
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.roundRect(x, y, width, 58, 29)
  ctx.fill()
  ctx.textBaseline = 'middle'
  ctx.font = `500 22px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(label, x + 22, y + 30)
  ctx.font = `700 26px ${FONT}`
  ctx.fillStyle = '#ffffff'
  ctx.fillText(value, x + 30 + labelWidth, y + 30)
  return x + width + 14
}

function segment(
  ctx: CanvasRenderingContext2D,
  part: VideoInput['first'],
  progress: number,
  levels: Uint8Array,
  colours: [string, string],
) {
  centred(ctx, part.label, 250, `800 92px ${FONT}`, '#ffffff')
  const date = part.round.created_at ? new Date(part.round.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : ''
  centred(ctx, date, 310, `500 28px ${FONT}`, 'rgba(255,255,255,0.55)')
  waveform(ctx, levels, 520, colours)

  // Captions: the transcript, revealed as the recording plays.
  const words = part.round.transcript.split(/\s+/)
  const shown = words.slice(0, Math.max(1, Math.ceil(words.length * Math.min(1, progress + 0.04)))).join(' ')
  ctx.font = `600 34px ${FONT}`
  const lines = wrap(ctx, shown, WIDTH - 152).slice(-5)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.roundRect(56, 700, WIDTH - 112, 300, 30)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'alphabetic'
  lines.forEach((line, i) => ctx.fillText(line, 86, 764 + i * 46))

  const m = part.round.measures
  let x = 56
  if (m.fillers_per_minute != null) x = chip(ctx, x, 1050, 'Fillers', `${m.fillers_per_minute}/min`)
  if (m.wpm != null) x = chip(ctx, x, 1050, 'Pace', `${m.wpm} wpm`)
  chip(ctx, 56, 1122, 'Long pauses', String(m.long_pauses))
}

function outro(ctx: CanvasRenderingContext2D, input: VideoInput) {
  let y = centred(ctx, 'What changed', 300, `800 76px ${FONT}`, '#ffffff')
  y += 50
  for (const { label, change, unit } of input.changes.slice(0, 5)) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.beginPath()
    ctx.roundRect(56, y, WIDTH - 112, 96, 26)
    ctx.fill()
    ctx.textBaseline = 'middle'
    ctx.font = `500 28px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(label, 86, y + 48)
    ctx.font = `700 32px ${FONT}`
    ctx.fillStyle = change.better ? '#30d158' : '#ffffff'
    const text = `${change.before}${unit} → ${change.after}${unit}`
    ctx.fillText(text, WIDTH - 86 - ctx.measureText(text).width, y + 48)
    y += 112
  }
  centred(ctx, 'Made with AI Pronunciation Coach', HEIGHT - 110, `500 26px ${FONT}`, 'rgba(255,255,255,0.55)')
}

/** Renders the video in real time (about as long as both recordings plus a few seconds). */
export async function makeProgressVideo(input: VideoInput, onProgress: (share: number) => void): Promise<{ blob: Blob; type: string }> {
  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t))!
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const audio = new AudioContext()
  try {
    const [first, latest] = await Promise.all([input.first.audio, input.latest.audio].map(async (b) => audio.decodeAudioData(await b.arrayBuffer())))
    const analyser = audio.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.7
    const out = audio.createMediaStreamDestination()
    analyser.connect(out)
    const levels = new Uint8Array(analyser.frequencyBinCount)

    const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...out.stream.getAudioTracks()])
    // About 1 Mbit/s keeps a video of two full one-minute answers under WhatsApp's 16 MB limit.
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data)
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))

    const start = audio.currentTime + 0.15
    const s1 = start + INTRO
    const e1 = s1 + first.duration
    const s2 = e1 + GAP
    const e2 = s2 + latest.duration
    const end = e2 + OUTRO
    for (const [buffer, at] of [[first, s1], [latest, s2]] as const) {
      const source = audio.createBufferSource()
      source.buffer = buffer
      source.connect(analyser)
      source.start(at)
    }
    recorder.start(250)

    await new Promise<void>((resolve) => {
      const draw = () => {
        const now = audio.currentTime
        background(ctx)
        brand(ctx)
        analyser.getByteFrequencyData(levels)
        if (now < s1) {
          const y = centred(ctx, 'My English', 470, `800 96px ${FONT}`, '#ffffff')
          centred(ctx, `${input.first.label} → ${input.latest.label}`, y + 30, `700 56px ${FONT}`, '#0a84ff')
          centred(ctx, `“${input.question}”`, y + 170, `500 34px ${FONT}`, 'rgba(255,255,255,0.7)')
        } else if (now < e1) {
          segment(ctx, input.first, (now - s1) / first.duration, levels, ['#8e8e93', '#636366'])
        } else if (now < s2) {
          centred(ctx, `${input.latest.label}`, 640, `800 92px ${FONT}`, '#ffffff')
        } else if (now < e2) {
          segment(ctx, input.latest, (now - s2) / latest.duration, levels, ['#0894ff', '#c959dd'])
        } else {
          outro(ctx, input)
        }
        onProgress(Math.min(1, (now - start) / (end - start)))
        if (now >= end) resolve()
      }
      // A timer, not requestAnimationFrame: drawing keeps going if the tab loses focus for a moment.
      const timer = window.setInterval(() => {
        draw()
        if (audio.currentTime >= end) window.clearInterval(timer)
      }, 1000 / FPS)
    })
    recorder.stop()
    await stopped
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), type: type.split(';')[0] }
  } finally {
    void audio.close()
  }
}
