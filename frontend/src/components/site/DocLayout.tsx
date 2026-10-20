import { ArrowRightIcon, EnvelopeSimpleIcon, LinkSimpleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Background } from '@/components/layout/Background'
import { LogoMark } from '@/components/layout/Logo'
import { scrollToHash, SITE_LINK, SiteFooter } from '@/components/site/SiteFooter'
import { Button } from '@/components/ui/button'
import { useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

export const REPOSITORY = 'https://github.com/alimehdikhan/A.I-Pronunciation-Coach'

/** Who runs this deployment and how to reach them (set on the server). */
export function useOperator() {
  const { data } = useHealth()
  return { name: data?.operator || 'The operator of this app', email: data?.contact_email ?? null }
}

/** The contact line: email when the operator set one, otherwise the project's public issue page. */
export function Contact() {
  const { email } = useOperator()
  return email ? (
    <a href={`mailto:${email}`} className="font-medium text-primary underline-offset-4 hover:underline">
      {email}
    </a>
  ) : (
    <>
      the{' '}
      <a
        href={`${REPOSITORY}/issues`}
        className="font-medium text-primary underline-offset-4 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        project’s GitHub issues page
      </a>{' '}
      (please don’t post personal details there; ask for a private contact instead)
    </>
  )
}

/** The header of every public page: brand, the main destinations, and the way into the app. */
export function PublicHeader() {
  const returning = useSettings((s) => !!s.accountEmail || s.guestChosen || s.onboarded)
  const sentinel = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div ref={sentinel} aria-hidden className="pointer-events-none absolute top-0 left-0 h-2 w-px" />
      <header data-scrolled={scrolled} className="home-header sticky top-0 z-30 text-foreground">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link
            to="/"
            aria-label="AI Pronunciation Coach, home"
            className={cn('flex items-center gap-2.5 text-[15px] font-semibold', SITE_LINK)}
          >
            <LogoMark className="size-8 rounded-[10px]" />
            <span className="hidden sm:inline">AI Pronunciation Coach</span>
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex">
            <Link to="/#features" className={SITE_LINK}>
              Features
            </Link>
            <Link to="/#interview" className={SITE_LINK}>
              Interviews
            </Link>
            <Link to="/help" className={SITE_LINK}>
              Help
            </Link>
            <Link to="/about" className={SITE_LINK}>
              About
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            {returning ? (
              <Button asChild size="sm">
                <Link to="/practice">
                  Open the app <ArrowRightIcon weight="bold" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/signup">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  )
}

export interface TocItem {
  id: string
  title: string
}

/** "On this page": the section being read is highlighted as you scroll. */
function Contents({ items, active }: { items: TocItem[]; active: string | null }) {
  return (
    <nav aria-label="On this page">
      <div className="text-[12px] font-semibold tracking-[0.02em] text-subtle uppercase">On this page</div>
      <ol className="mt-3 space-y-0.5 border-l border-border">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(event) => {
                if (scrollToHash(item.id)) {
                  event.preventDefault()
                  history.replaceState(null, '', `#${item.id}`)
                }
              }}
              aria-current={active === item.id ? 'location' : undefined}
              className={cn(
                '-ml-px block border-l-2 py-1.5 pl-4 text-[13.5px] leading-snug transition-colors duration-150',
                active === item.id
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** A section of a document, with a link to itself. */
export function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="doc-section group scroll-mt-24">
      <h2 className="flex items-center gap-2 text-[23px] leading-tight font-semibold tracking-[-0.02em]">
        {title}
        <a
          href={`#${id}`}
          aria-label={`Link to “${title}”`}
          className="text-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <LinkSimpleIcon size={18} weight="bold" />
        </a>
      </h2>
      <div className="doc-body mt-4">{children}</div>
    </section>
  )
}

/** A highlighted summary at the top of a document. */
export function AtAGlance({ title = 'At a glance', items }: { title?: string; items: ReactNode[] }) {
  return (
    <div className="rounded-[24px] bg-primary-soft/70 p-6 ring-1 ring-primary/15 sm:p-7">
      <div className="text-[15px] font-semibold">{title}</div>
      <ul className="mt-3 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[15px] leading-snug">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A long-form public page: title, contents that follow your reading, sections and a contact card. */
export function DocLayout({
  title,
  intro,
  updated,
  toc,
  children,
  wide = false,
  tabTitle,
}: {
  title: string
  intro: ReactNode
  updated?: string
  toc: TocItem[]
  children: ReactNode
  /** Help pages use the full width for cards; legal text keeps a reading measure. */
  wide?: boolean
  /** The browser tab's name, when it should differ from the heading. */
  tabTitle?: string
}) {
  const { hash } = useLocation()

  useEffect(() => {
    const previous = document.title
    document.title = `${tabTitle ?? title} · AI Pronunciation Coach`
    return () => {
      document.title = previous
    }
  }, [tabTitle, title])
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null)
  const body = useRef<HTMLDivElement>(null)
  const [minutes, setMinutes] = useState<number | null>(null)

  // Open at a section when linked to one (/about#contact); otherwise start at the top.
  useEffect(() => {
    if (!hash || !scrollToHash(hash, false)) window.scrollTo({ top: 0 })
  }, [hash])

  // Which section is being read: the last one whose heading has passed the top third of the screen.
  useEffect(() => {
    const sections = toc.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => !!el)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -65% 0px' },
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [toc])

  useEffect(() => {
    const words = body.current?.innerText.split(/\s+/).length ?? 0
    setMinutes(Math.max(1, Math.round(words / 230)))
  }, [])

  return (
    <div className="relative min-h-dvh">
      <Background />
      <PublicHeader />
      <main className="relative">
        <div className="mx-auto max-w-6xl px-4 pt-14 pb-10 sm:pt-20">
          <h1 className="headline max-w-3xl text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.03em] text-balance">{title}</h1>
          <div className="mt-4 max-w-2xl text-[18px] leading-relaxed text-pretty text-muted-foreground">{intro}</div>
          {(updated || minutes) && (
            <p className="mt-5 text-[13px] text-subtle">
              {updated && <>Last updated {updated}</>}
              {updated && minutes ? ' · ' : ''}
              {minutes ? `${minutes} min read` : ''}
            </p>
          )}
        </div>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <Contents items={toc} active={active} />
            </div>
          </aside>
          <div ref={body} className={cn('min-w-0 space-y-14', !wide && 'max-w-[70ch]')}>
            <details className="rounded-2xl bg-fill px-5 py-4 lg:hidden">
              <summary className="cursor-pointer text-[14px] font-semibold select-none">On this page</summary>
              <ol className="mt-3 space-y-2 text-[14px]">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="text-muted-foreground hover:text-foreground">
                      {item.title}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
            {children}
            <ContactCard />
          </div>
        </div>
        <SiteFooter />
      </main>
    </div>
  )
}

function ContactCard() {
  return (
    <div className="flex flex-col gap-4 rounded-[24px] bg-fill p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
      <div className="flex gap-3">
        <EnvelopeSimpleIcon size={24} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
        <div>
          <div className="text-[16px] font-semibold">Still have a question?</div>
          <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">
            Contact <Contact />.
          </p>
        </div>
      </div>
      <Button asChild variant="secondary" className="shrink-0">
        <Link to="/help">Help centre</Link>
      </Button>
    </div>
  )
}
