import { WaveformIcon } from '@phosphor-icons/react'
import { useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useVoiceUI } from '@/store/voice'

/** Opens the spoken conversation. Not shown when the server has no voice agent switched on. */
export function TalkButton({ className }: { className?: string }) {
  const { data: health } = useHealth()
  const open = useVoiceUI((s) => s.setOpen)
  if (!health?.voice_agent) return null
  return (
    <button
      type="button"
      onClick={() => open(true)}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full bg-fill py-1 pr-3.5 pl-1 text-[13px] font-semibold outline-none',
        'transition-[background-color,transform] duration-150 ease-out hover:bg-fill-strong active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      {/* The coach's voice, in the same colours as the coach itself. */}
      <span
        aria-hidden
        className="bg-ai grid size-7 place-items-center rounded-full text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_3px_10px_-3px_rgb(201_89_221/0.7)]"
      >
        <WaveformIcon size={15} weight="bold" />
      </span>
      Talk to your coach
    </button>
  )
}
