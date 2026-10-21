import { cn } from '@/lib/utils'

/** App icon: waveform on the Apple Intelligence gradient. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-ai shadow-[0_2px_8px_-2px_rgb(201_89_221/0.5)]',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[62%] text-white" fill="currentColor" aria-hidden>
        <rect x="3" y="10" width="2.4" height="4" rx="1.2" />
        <rect x="7.2" y="6.5" width="2.4" height="11" rx="1.2" />
        <rect x="11.4" y="3.5" width="2.4" height="17" rx="1.2" />
        <rect x="15.6" y="7.5" width="2.4" height="9" rx="1.2" />
        <rect x="19.8" y="10.5" width="2.4" height="3" rx="1.2" />
      </svg>
      <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/25 to-transparent" />
    </div>
  )
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">Vocaly AI</span>
    </div>
  )
}
