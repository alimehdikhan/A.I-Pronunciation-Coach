import { toast } from 'sonner'
import { ApiError } from './api'

export interface FriendlyError {
  title: string
  /** What to do about it. */
  fix: string
  /** Seconds until it is worth trying again (from Retry-After). */
  retryAfter?: number
  /** The microphone may be the problem: offer the mic check. */
  micCheck?: boolean
}

/** A failed request in words a learner can act on. Unknown errors keep the server's own sentence. */
export function friendlyError(error: unknown): FriendlyError {
  if (!(error instanceof ApiError)) {
    return { title: 'Something went wrong', fix: error instanceof Error ? error.message : 'Please try again.' }
  }
  const retryAfter = error.retryAfter
  switch (error.code) {
    case 'models_loading':
      return { title: 'The speech models are still warming up', fix: 'This takes about a minute after the server starts.', retryAfter }
    case 'busy':
      return { title: 'The coach is busy with other recordings', fix: 'Yours will go through in a moment.', retryAfter }
    case 'rate_limited':
      return { title: 'That was a lot of recordings in a minute', fix: 'Take a breath; you can go again shortly.', retryAfter }
    case 'too_short':
      return { title: 'That recording was too short', fix: 'Hold the mic until you have said the whole phrase.', micCheck: true }
    case 'recording_too_long':
      return { title: 'That recording was too long', fix: error.message.replace(/^Recordings/, 'Keep recordings to') }
    case 'upload_too_large':
      return { title: 'That file is too large', fix: 'Record directly in the app, or upload a shorter clip.' }
    case 'audio_empty':
      return { title: 'The recording was empty', fix: 'Check the right microphone is selected, then try again.', micCheck: true }
    case 'audio_unreadable':
    case 'unsupported_audio':
      return { title: 'We couldn’t read that audio', fix: 'Try recording again, or use a WAV, MP3, M4A, OGG or WebM file.' }
  }
  if (error.status === 0) return { title: 'Can’t reach the server', fix: 'Check your connection and try again.' }
  return { title: error.message, fix: '' }
}

/** One line for inline status text. */
export function errorLine(error: unknown): string {
  const e = friendlyError(error)
  return e.fix ? `${e.title}. ${e.fix}` : e.title
}

let openMicCheck: (() => void) | null = null
/** Lets the error toasts offer the mic check without importing the UI store here. */
export function registerMicCheck(open: () => void) {
  openMicCheck = open
}

/** A toast for a failed request; when the server said how long to wait, it counts down. */
export function showError(error: unknown) {
  const e = friendlyError(error)
  const action = e.micCheck && openMicCheck ? { label: 'Check microphone', onClick: () => openMicCheck?.() } : undefined
  if (!e.retryAfter) {
    toast.error(e.title, { description: e.fix || undefined, action })
    return
  }
  const id = `retry-${e.title}`
  let left = Math.ceil(e.retryAfter)
  const render = () =>
    left > 0
      ? toast.warning(e.title, { id, description: `${e.fix} Try again in ${left}s.`, duration: Infinity })
      : toast.success('Ready. Try again now.', { id, description: undefined, duration: 4000 })
  render()
  const timer = window.setInterval(() => {
    left -= 1
    render()
    if (left <= 0) window.clearInterval(timer)
  }, 1000)
}
