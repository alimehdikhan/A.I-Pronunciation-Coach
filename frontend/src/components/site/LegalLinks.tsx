import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/** Privacy · Terms · Help · About, for footers inside the app. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn('flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-subtle', className)}>
      <Link to="/privacy" className="hover:text-foreground hover:underline">
        Privacy
      </Link>
      <Link to="/terms" className="hover:text-foreground hover:underline">
        Terms
      </Link>
      <Link to="/help" className="hover:text-foreground hover:underline">
        Help
      </Link>
      <Link to="/about" className="hover:text-foreground hover:underline">
        About
      </Link>
    </nav>
  )
}
