import { SpeakerHighIcon, SpeakerSimpleHighIcon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useSpeaker } from '@/lib/speech'
import { cn } from '@/lib/utils'

function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]">
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[2.5px] rounded-full bg-current"
          animate={{ height: ['30%', '100%', '45%', '80%', '30%'] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </span>
  )
}

/** Pill that speaks a word or phrase with the coach voice. */
export function SpeakChip({
  text,
  rate = 0.85,
  className,
  children,
  tone = 'neutral',
}: {
  text: string
  rate?: number
  className?: string
  children?: ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'primary'
}) {
  const { speak, prefetch, speakingKey, supported } = useSpeaker()
  const active = speakingKey === `chip:${text}`
  const tones = {
    neutral: 'bg-fill text-foreground hover:bg-fill-strong',
    good: 'bg-good-soft text-good hover:brightness-110',
    bad: 'bg-bad-soft text-bad hover:brightness-110',
    primary: 'bg-primary-soft text-primary hover:brightness-110',
  }
  return (
    <button
      type="button"
      disabled={!supported}
      onClick={() => speak(text, { key: `chip:${text}`, rate })}
      onPointerEnter={() => prefetch(text, rate)}
      onFocus={() => prefetch(text, rate)}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[14px] font-medium transition-all active:scale-[0.97]',
        tones[tone],
        active && 'ring-2 ring-primary/40',
        className,
      )}
    >
      {active ? <Equalizer /> : <SpeakerSimpleHighIcon size={15} weight="fill" className="shrink-0 opacity-50" />}
      {children ?? text}
    </button>
  )
}

/** Labelled listen button with an animated equaliser while speaking. */
export function ListenButton({
  text,
  rate = 1,
  label = 'Listen',
  speakKey,
  className,
}: {
  text: string
  rate?: number
  label?: string
  speakKey: string
  className?: string
}) {
  const { speak, stop, speakingKey, supported } = useSpeaker()
  const active = speakingKey === speakKey
  return (
    <button
      type="button"
      disabled={!supported || !text}
      onClick={() => (active ? stop() : speak(text, { key: speakKey, rate }))}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full bg-fill px-4 text-[13px] font-medium text-foreground transition-all hover:bg-fill-strong active:scale-[0.97] disabled:opacity-40',
        active && 'bg-primary-soft text-primary',
        className,
      )}
    >
      {active ? <Equalizer /> : <SpeakerHighIcon size={16} weight="fill" />}
      {label}
    </button>
  )
}
