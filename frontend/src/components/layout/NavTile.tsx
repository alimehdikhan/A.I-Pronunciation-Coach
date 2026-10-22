import { cn } from '@/lib/utils'
import type { NavItem } from './nav'

/** A page's icon as a small app-style tile: a white symbol on the page's own colour. */
export function NavTile({ item, size = 22, className }: { item: NavItem; size?: number; className?: string }) {
  const IconComp = item.icon
  const glyph = Math.round(size * 0.64)
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-[6px] text-white',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_1px_2px_rgb(0_0_0/0.16)]',
        item.tile,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <IconComp weight={item.glyph ?? 'fill'} className="text-white" style={{ width: glyph, height: glyph }} />
    </span>
  )
}
