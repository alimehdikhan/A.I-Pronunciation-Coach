import { Link, useLocation } from 'react-router'
import { LogoMark } from '@/components/layout/Logo'
import { cn } from '@/lib/utils'

export const SITE_LINK =
  'rounded-sm transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none'

/** In-page links glide to their section (unless the visitor prefers reduced motion), on any public page. */
export function scrollToHash(hash: string, smooth = true): boolean {
  const target = hash ? document.getElementById(hash.replace(/^#/, '')) : null
  if (!target) return false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' })
  return true
}

const COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/#features' },
      { label: 'Interview prep', to: '/#interview' },
      { label: 'How it works', to: '/#how' },
      { label: 'Start free', to: '/signup' },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Help centre', to: '/help' },
      { label: 'Getting started', to: '/help#getting-started' },
      { label: 'FAQ', to: '/help#faq' },
      { label: 'Troubleshooting', to: '/help#troubleshooting' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/about#contact' },
      { label: 'Sign in', to: '/login' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Terms of Use', to: '/terms' },
      { label: 'Cookies', to: '/privacy#cookies' },
    ],
  },
]

/** The footer of every public page. */
export function SiteFooter() {
  const { pathname } = useLocation()
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div className="max-w-xs">
          <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold">
            <LogoMark className="size-8 rounded-[10px]" /> Vocaly AI
          </Link>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Speak English that people understand, in interviews, exams, calls and presentations.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-[13px] font-semibold">{column.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {column.links.map((link) => {
                const [path, hash] = link.to.split('#')
                return (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      onClick={(event) => {
                        // Already on that page: glide to the section instead of jumping.
                        if (hash && pathname === (path || '/') && scrollToHash(hash)) {
                          event.preventDefault()
                          history.replaceState(null, '', `#${hash}`)
                        }
                      }}
                      className={cn('text-[14px] text-muted-foreground', SITE_LINK)}
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-subtle">
          <span>© {new Date().getFullYear()} Vocaly AI. All rights reserved.</span>
          <span className="flex gap-4">
            <Link to="/privacy" className={SITE_LINK}>
              Privacy
            </Link>
            <Link to="/terms" className={SITE_LINK}>
              Terms
            </Link>
            <Link to="/help" className={SITE_LINK}>
              Help
            </Link>
          </span>
        </div>
      </div>
    </footer>
  )
}
