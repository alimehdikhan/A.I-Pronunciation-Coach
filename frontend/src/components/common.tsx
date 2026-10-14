import { motion } from 'motion/react'
import { ToggleGroup } from 'radix-ui'
import type { HTMLAttributes, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Elevated content surface (white card on light, #1c1c1e on dark). */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface', className)} {...props} />
}

/** Small uppercase section heading, Apple Settings style. */
export function SectionLabel({
  icon,
  children,
  action,
  className,
}: {
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex items-center justify-between gap-3', className)}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {children}
      </h3>
      {action}
    </div>
  )
}

const pillTones = {
  neutral: 'bg-fill text-muted-foreground',
  primary: 'bg-primary-soft text-primary',
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  extra: 'bg-extra-soft text-extra',
}

export type PillTone = keyof typeof pillTones

export function Pill({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5',
        pillTones[tone],
        className,
      )}
      {...props}
    />
  )
}

/** Tooltip shorthand. */
export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

/** iOS-style segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  layoutId,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  size?: 'sm' | 'md'
  className?: string
  layoutId: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn('relative inline-flex rounded-[10px] bg-fill p-[3px]', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              'relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-4 text-[13px]',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-[8px] bg-card shadow-[0_1px_3px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)] dark:bg-[#636366]"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
              />
            )}
            {option.icon}
            {option.label}
          </ToggleGroup.Item>
        )
      })}
    </ToggleGroup.Root>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <div className="mb-5 grid size-16 place-items-center rounded-[20px] bg-fill text-primary [&_svg]:size-8">{icon}</div>
      <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[15px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function StatusDot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative flex size-2">
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', className)} />}
      <span className={cn('relative size-2 rounded-full', className)} />
    </span>
  )
}
