import { SpeakerHighIcon, StopIcon } from '@phosphor-icons/react'
import { useSpeaker } from '@/lib/speech'
import { cn } from '@/lib/utils'

/** Listen to text of any length in the coach's voice (long text is read sentence by sentence). */
export function ListenLong({ text, speakKey, label = 'Listen', className }: { text: string; speakKey: string; label?: string; className?: string }) {
  const { say, stop, speakingKey } = useSpeaker()
  const active = speakingKey === speakKey
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() => (active ? stop() : void say(text, { key: speakKey, store: 'none' }))}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-fill active:scale-[0.97] disabled:opacity-40',
        active && 'text-primary',
        className,
      )}
    >
      {active ? <StopIcon size={14} weight="fill" /> : <SpeakerHighIcon size={15} weight="fill" />}
      {active ? 'Stop' : label}
    </button>
  )
}
