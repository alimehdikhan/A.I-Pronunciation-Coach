/**
 * Moments the corner coach reacts to, sent from anywhere in the app: `cheer` for a great attempt,
 * `nod` for an ordinary one.
 */
export type CoachCue = 'cheer' | 'nod'

const EVENT = 'coach:cue'

export function cueCoach(cue: CoachCue) {
  window.dispatchEvent(new CustomEvent<CoachCue>(EVENT, { detail: cue }))
}

export function onCoachCue(handler: (cue: CoachCue) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<CoachCue>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
