import { cn } from '@/lib/utils'

/** App icon: the Vocaly mark, a V that runs into a sound wave (transparent PNG, works on both themes). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      aria-hidden
      draggable={false}
      className={cn('size-8 shrink-0 select-none object-contain', className)}
    />
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
