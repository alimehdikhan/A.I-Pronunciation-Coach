import { MicrophoneIcon, StopIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * The face of a small record button: a lit blue disc with the microphone (red with a stop square while
 * recording), with a soft inner highlight and a coloured glow so it reads as something to press.
 * Put it inside a `group` button; the symbol grows a touch on hover.
 */
export function MicDisc({ size = 44, recording = false, className }: { size?: number; recording?: boolean; className?: string }) {
  const glyph = Math.round(size * (recording ? 0.38 : 0.45))
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid place-items-center rounded-full bg-gradient-to-b text-white',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.4),inset_0_-3px_8px_rgb(0_0_0/0.14)]',
        recording
          ? 'from-[#ff6f61] to-[#ff2d20] ring-4 ring-[#ff3b30]/20'
          : 'from-[#56a8ff] to-[#0a66f5] [box-shadow:inset_0_1px_0_rgb(255_255_255/0.4),inset_0_-3px_8px_rgb(0_0_0/0.14),0_6px_16px_-6px_rgb(10_102_245/0.75)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {recording ? (
        <StopIcon size={glyph} weight="fill" />
      ) : (
        <MicrophoneIcon
          size={glyph}
          weight="fill"
          className="drop-shadow-[0_1px_1px_rgb(0_0_0/0.18)] transition-transform duration-150 ease-out group-hover:scale-110"
        />
      )}
    </span>
  )
}
