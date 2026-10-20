import { MicrophoneIcon, MicrophoneSlashIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn, formatDuration, initials } from '@/lib/utils'

/** How long the call has been running. */
export function CallTimer() {
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(start)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="shrink-0 text-white/45 tabular-nums">{formatDuration((now - start) / 1000)}</span>
}

/** Three bars that move while the interviewer talks (transform only; still under reduced motion). */
export function SpeakingBars() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-full w-[3px] origin-bottom rounded-full bg-good [animation:speak-bar_0.9s_ease-in-out_infinite] motion-reduce:[animation:none]"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  )
}

/** A round control in the call bar, labelled underneath. */
export function CallButton({
  label,
  hotkey,
  pressed,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string
  hotkey?: string
  pressed?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={hotkey ? `${label} (${hotkey})` : label}
        aria-pressed={pressed}
        className={cn(
          'grid size-12 place-items-center rounded-full text-white sm:size-14 transition-[background-color,transform] duration-150 ease-out active:scale-[0.95] focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none disabled:opacity-35',
          danger ? 'bg-[#ff453a] hover:bg-[#ff453a]/90' : pressed ? 'bg-white text-black hover:bg-white/90' : 'bg-white/12 hover:bg-white/20',
        )}
      >
        {children}
      </button>
      <span className="text-[11px] text-white/55">{label}</span>
    </div>
  )
}

/** The learner's own window, picture-in-picture: their initials, and a ring that moves with their voice. */
export function YouTile({
  name,
  live,
  readLevel,
  className,
}: {
  name: string
  live: boolean
  readLevel: () => { level: number } | null
  className?: string
}) {
  const ring = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ring.current
    if (!el) return
    if (!live || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.transform = 'scale(1)'
      return
    }
    let frame = 0
    const loop = () => {
      el.style.transform = `scale(${1 + Math.min(1, readLevel()?.level ?? 0) * 0.45})`
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [live, readLevel])
  return (
    <div className={cn('w-28 overflow-hidden rounded-2xl bg-[#1d1d21] shadow-[0_12px_30px_-12px_rgb(0_0_0/0.7)] ring-1 ring-white/10 sm:w-44', className)}>
      <div className="relative grid aspect-[4/3] place-items-center">
        <span
          ref={ring}
          aria-hidden
          className={cn('absolute size-12 rounded-full sm:size-16', live ? 'bg-good/25' : 'bg-white/5')}
          style={{ transition: 'transform 90ms linear' }}
        />
        <span className="relative grid size-10 place-items-center rounded-full bg-gradient-to-br from-[#5e5ce6] to-[#0a84ff] text-[14px] font-semibold text-white sm:size-12 sm:text-[16px]">
          {initials(name)}
        </span>
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
          {live ? <MicrophoneIcon weight="fill" className="text-good" /> : <MicrophoneSlashIcon weight="fill" className="text-white/60" />}
          You
        </span>
      </div>
    </div>
  )
}
