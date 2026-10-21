import { ArrowRightIcon, CaretRightIcon, CheckCircleIcon, EarIcon, SpeakerHighIcon, XCircleIcon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import confident from '@/assets/home/confident.webp'
import featureInterview from '@/assets/home/feature-interview.webp'
import featureListen from '@/assets/home/feature-listen.webp'
import heroInterview from '@/assets/home/hero-interview.webp'
import heroInterviewLarge from '@/assets/home/hero-interview-2400.webp'
import heroInterviewSmall from '@/assets/home/hero-interview-800.webp'
import struggleCall from '@/assets/home/struggle-call.webp'
import struggleLaptop from '@/assets/home/struggle-laptop.webp'
import struggleWords from '@/assets/home/struggle-words.webp'
import { Background } from '@/components/layout/Background'
import { LogoMark } from '@/components/layout/Logo'
import { scrollToHash, SiteFooter } from '@/components/site/SiteFooter'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

// Strong ease-out: starts fast so the page feels responsive, settles without overshoot.
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const LINK = 'rounded-sm transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none'
// Arrow nudges toward where the button goes, only on devices that really hover.
const ARROW = 'transition-transform duration-200 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover/button:translate-x-0.5'
const HEADER_HEIGHT = 56

/** In-page links glide to their section, unless the visitor prefers reduced motion. */
function scrollToSection(event: React.MouseEvent<HTMLAnchorElement>) {
  const id = event.currentTarget.getAttribute('href')?.slice(1)
  const target = id ? document.getElementById(id) : null
  if (!target) return
  event.preventDefault()
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
}

/** A big, tightly set section title with a short lede. */
function SectionTitle({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h2 className="headline text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.04] tracking-[-0.03em] text-balance">{title}</h2>
      {lede && <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-pretty text-muted-foreground sm:text-[19px]">{lede}</p>}
    </div>
  )
}

/* Product UI, drawn the way the app draws it. */

function Tile({ className, title, text, children }: { className?: string; title: string; text: string; children: ReactNode }) {
  return (
    <div className={cn('surface flex h-full flex-col p-6 sm:p-8', className)}>
      <h3 className="text-[21px] leading-tight font-semibold tracking-[-0.02em] sm:text-[24px]">{title}</h3>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-pretty text-muted-foreground">{text}</p>
      <div className="mt-8 flex flex-1 items-end">{children}</div>
    </div>
  )
}

const TRANSCRIPT: { word: string; kind?: 'fix' | 'check' }[] = [
  { word: 'I' },
  { word: 'think', kind: 'fix' },
  { word: 'the' },
  { word: 'weather' },
  { word: 'will' },
  { word: 'be' },
  { word: 'very', kind: 'check' },
  { word: 'warm' },
]

function TranscriptDemo() {
  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-x-1.5 gap-y-1 text-[24px] font-semibold tracking-[-0.02em] sm:text-[30px]">
        {TRANSCRIPT.map(({ word, kind }) => (
          <span
            key={word}
            className={cn(
              'rounded-lg px-1',
              kind === 'fix' && 'bg-bad-soft text-bad',
              kind === 'check' && 'bg-warn-soft text-warn outline-2 -outline-offset-2 outline-warn/50 outline-dashed',
            )}
          >
            {word}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-semibold">
        <span className="rounded-full bg-bad-soft px-2.5 py-1 text-bad">Fix this · “th” said as “s”</span>
        <span className="rounded-full border border-dashed border-warn/60 bg-warn-soft px-2.5 py-1 text-warn">Worth checking · “v”</span>
      </div>
      <div className="mt-5 flex items-center gap-2.5 border-t border-border pt-4 text-[14px]">
        <EarIcon size={20} weight="fill" className="shrink-0 text-primary" />
        <span>
          <span className="text-muted-foreground">Would a listener understand you?</span> <b className="text-good">Mostly</b>, 7 of 8
          words came through.
        </span>
      </div>
    </div>
  )
}

function ListenDemo() {
  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <SpeakerHighIcon weight="fill" className="text-primary" /> Emma, British
        </span>
        <span className="tabular-nums">7 of 20</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border-2 border-good bg-good-soft py-5 text-center text-[22px] font-semibold text-good">think</div>
        <div className="rounded-2xl border-2 border-border py-5 text-center text-[22px] font-semibold text-muted-foreground">sink</div>
      </div>
    </div>
  )
}

function TipDemo() {
  return (
    <div className="w-full">
      <div className="text-[13px] font-semibold text-muted-foreground">Tip in Hindi for “very”</div>
      <p lang="hi" className="mt-1.5 text-[19px] leading-relaxed">
        ऊपर के दाँत निचले होंठ पर हल्के से टिकाएँ और गूँज के साथ बोलें।
      </p>
    </div>
  )
}

// Bar heights (0–1) for the before/after waveforms: computed once, so the picture never changes between renders.
// Day 1 is hesitant and uneven; day 30 is steady and full.
const WAVE_BEFORE = Array.from({ length: 56 }, (_, i) => 0.12 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31)))
const WAVE_AFTER = Array.from({ length: 56 }, (_, i) => 0.4 + 0.55 * Math.abs(Math.sin(i * 0.83 + 0.4)))

function ProgressDemo() {
  return (
    <div className="w-full space-y-3">
      {[
        { label: 'Day 1', bars: WAVE_BEFORE, tone: 'bg-muted-foreground/35' },
        { label: 'Day 30', bars: WAVE_AFTER, tone: 'bg-primary' },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-4">
          <span className="w-12 shrink-0 text-[13px] text-muted-foreground tabular-nums">{row.label}</span>
          <span className="flex h-10 flex-1 items-center justify-between" aria-hidden>
            {row.bars.map((h, i) => (
              <span key={i} className={cn('w-[3px] rounded-full', row.tone, i % 2 === 1 && 'max-sm:hidden')} style={{ height: `${h * 100}%` }} />
            ))}
          </span>
        </div>
      ))}
      <div className="pt-1 text-[12px] text-subtle">Illustration</div>
    </div>
  )
}

const RUBRIC = [
  { label: 'Answers the question', value: 5 },
  { label: 'Clear structure', value: 3 },
  { label: 'Specific example', value: 2 },
]

const STAR = [
  { part: 'Situation', done: true },
  { part: 'Task', done: true },
  { part: 'Action', done: true },
  { part: 'Result', done: false },
]

function InterviewDemo() {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 text-[16px] leading-snug font-semibold">
        <SpeakerHighIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-primary" />
        “Tell me about a time you solved a difficult problem at work.”
      </div>
      <div className="space-y-2.5">
        {RUBRIC.map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-[13px]">
            <span className="w-40 shrink-0 text-muted-foreground">{row.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${row.value * 20}%` }} />
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
        {STAR.map(({ part, done }) => (
          <span key={part} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1', done ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad')}>
            {done ? <CheckCircleIcon weight="fill" /> : <XCircleIcon weight="fill" />} {part}
          </span>
        ))}
      </div>
      <p className="text-[14px] leading-snug">
        <b className="text-bad">Missing:</b> what happened in the end. Close with the result.
      </p>
    </div>
  )
}

/* Page content. */

const STRUGGLES = [
  { src: struggleLaptop, alt: 'A man at his laptop holding his head in frustration', quote: '“Sorry, could you say that again?”', note: 'On every call.' },
  { src: struggleWords, alt: 'A young man with his hand over his face, lost for words', quote: 'You know the answer.', note: 'The words come out wrong.' },
  { src: struggleCall, alt: 'A worried woman listening on a phone call', quote: 'The call you keep putting off.', note: 'In case they don’t understand you.' },
]

const STEPS = [
  { title: 'Speak.', text: 'A sentence, an interview question or an everyday situation. Just talk, the way you would.' },
  { title: 'See what a listener hears.', text: 'Every word and sound is checked, and the coach picks the one thing worth changing first.' },
  { title: 'Practise the fix.', text: 'Drills, listening practice and a short guided session on the sound that matters most.' },
]

/** The public home page: who it is for, what it does (shown, not described), and how to start. */
export default function HomePage() {
  // Someone who already signed in or practised here goes straight back to the app.
  const returning = useSettings((s) => !!s.accountEmail || s.guestChosen || s.onboarded)
  const topRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  // While the bar sits over the photo it uses the dark palette, whatever the app theme.
  const [overHero, setOverHero] = useState(true)
  // Arriving from another page at a section (/#features): open there.
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) requestAnimationFrame(() => scrollToHash(hash, false))
  }, [hash])
  // Observers instead of a scroll listener: nothing runs on scroll frames, and no layout is read.
  useEffect(() => {
    const top = topRef.current
    const hero = heroRef.current
    if (!top || !hero) return
    const topObserver = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    const heroObserver = new IntersectionObserver(([entry]) => setOverHero(entry.isIntersecting), {
      rootMargin: `-${HEADER_HEIGHT}px 0px 0px 0px`,
    })
    topObserver.observe(top)
    heroObserver.observe(hero)
    return () => {
      topObserver.disconnect()
      heroObserver.disconnect()
    }
  }, [])

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <Background />
      <div ref={topRef} aria-hidden className="pointer-events-none absolute top-0 left-0 h-2 w-px" />

      <header data-scrolled={scrolled} className={cn('home-header fixed inset-x-0 top-0 z-30 text-foreground', overHero && 'dark')}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link
            to="/"
            aria-label="Vocaly AI, home"
            className="flex items-center gap-2.5 rounded-sm text-[15px] font-semibold focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <LogoMark />
            <span className="hidden sm:inline">Vocaly AI</span>
          </Link>
          <nav aria-label="Page" className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex">
            <a href="#features" onClick={scrollToSection} className={LINK}>
              Features
            </a>
            <a href="#interview" onClick={scrollToSection} className={LINK}>
              Interviews
            </a>
            <a href="#how" onClick={scrollToSection} className={LINK}>
              How it works
            </a>
            <Link to="/help" className={LINK}>
              Help
            </Link>
            <Link to="/about" className={LINK}>
              About
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            {returning ? (
              <Button asChild size="sm">
                <Link to="/practice">
                  Open the app <ArrowRightIcon weight="bold" className={ARROW} />
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

      <main className="relative">
        {/* Hero: the photo fills the first screen; the promise sits on the dark lower third. */}
        <section
          ref={heroRef}
          aria-labelledby="hero-title"
          className="dark relative isolate flex h-[100svh] min-h-[620px] flex-col justify-end overflow-hidden bg-black text-white"
        >
          {/* Mirrored so the speaker sits on the right and the words sit beside him, never on his face. */}
          <div className="absolute inset-0 -z-10 -scale-x-100">
            {/* The one authored moment: the photo settles into place. Transform only, so it stays on the GPU. */}
            <motion.img
              src={heroInterview}
              srcSet={`${heroInterviewSmall} 800w, ${heroInterview} 1600w, ${heroInterviewLarge} 2400w`}
              sizes="100vw"
              width={2400}
              height={1654}
              alt="A young man in a job interview, hands clasped, listening carefully to the interviewer"
              fetchPriority="high"
              decoding="async"
              initial={{ transform: 'scale(1.05)' }}
              animate={{ transform: 'scale(1)' }}
              transition={{ duration: 1.4, ease: EASE_OUT }}
              className="size-full object-cover object-[38%_30%]"
            />
          </div>
          {/* Scrims: a little at the top for the bar, deep at the bottom and, on wide screens, the left for the words. */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(0_0_0/0.62)_0%,rgb(0_0_0/0.2)_12%,rgb(0_0_0/0)_26%,rgb(0_0_0/0.15)_42%,rgb(0_0_0/0.7)_66%,rgb(0_0_0/0.92)_100%)]"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 hidden bg-[linear-gradient(to_right,rgb(0_0_0/0.72)_0%,rgb(0_0_0/0.4)_38%,rgb(0_0_0/0)_62%)] md:block"
          />
          <motion.div
            initial={{ opacity: 0, transform: 'translateY(16px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.2 }}
            className="mx-auto w-full max-w-6xl px-4 pb-[max(3.5rem,9svh)] text-center md:text-left"
          >
            <h1
              id="hero-title"
              className="headline mx-auto max-w-3xl text-[clamp(2.5rem,min(6.6vw,11svh),5.25rem)] leading-[1.0] tracking-[-0.03em] text-balance [text-shadow:0_2px_30px_rgb(0_0_0/0.35)] md:mx-0"
            >
              Speak English that people understand.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-pretty text-white/85 sm:text-[19px] md:mx-0">
              The coach listens to every sound you say, shows you what a listener hears, and trains you until it comes out right. For job
              interviews, IELTS, calls and presentations.
            </p>
            <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-8 md:justify-start">
              <Button asChild size="lg" className="h-12 px-8 text-[16px]">
                <Link to="/signup">
                  Start free <ArrowRightIcon weight="bold" className={ARROW} />
                </Link>
              </Button>
              <a
                href="#how"
                onClick={scrollToSection}
                className="group/link flex items-center gap-0.5 rounded-sm text-[16px] font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                See how it works
                <CaretRightIcon
                  weight="bold"
                  className="size-4 transition-transform duration-200 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover/link:translate-x-0.5"
                />
              </a>
            </div>
          </motion.div>
        </section>

        {/* The problem, told through people. */}
        <section id="why" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-24 sm:pt-36">
          <SectionTitle
            title="Knowing English isn’t the same as being understood."
            lede="Most learners don’t need more grammar. They need to know which sounds get in the way, and to hear the difference themselves."
          />
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {STRUGGLES.map((s) => (
              <figure key={s.quote} className="group relative overflow-hidden rounded-3xl bg-fill">
                <img
                  src={s.src}
                  alt={s.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/5] w-full object-cover transition-transform duration-500 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.03]"
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-6 pt-28 text-left text-white">
                  <div className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{s.quote}</div>
                  <div className="mt-1 text-[15px] text-white/80">{s.note}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* The product, shown rather than described. */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-28 sm:pt-40">
          <SectionTitle title="See exactly what a listener hears." />
          <div className="mt-14 grid gap-4 md:grid-cols-6">
            <Tile
              className="md:col-span-4"
              title="Every sound, not just a score."
              text="All 41 English sounds are checked in every word, with scores tuned on 5,000 recordings rated by experts. When the coach is sure, it says Fix this. When it isn’t, it says so."
            >
              <TranscriptDemo />
            </Tile>
            <Tile className="md:col-span-2" title="Train your ear." text="Hear each word in one of nine voices, American and British, and pick which one it was.">
              <ListenDemo />
            </Tile>
            <Tile className="md:col-span-2" title="In your language." text="Sounds that are hard for your first language come first, with tips in Hindi or Urdu.">
              <TipDemo />
            </Tile>
            <Tile
              className="md:col-span-4"
              title="Hear how far you’ve come."
              text="Record five sentences now and again in a few weeks, then play them side by side."
            >
              <ProgressDemo />
            </Tile>
          </div>
        </section>

        {/* Interview practice, in depth. */}
        <section id="interview" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-28 sm:pt-40">
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <img
              src={featureInterview}
              alt="An interviewer listening closely to a candidate across a desk"
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] w-full rounded-3xl bg-fill object-cover"
            />
            <div>
              <h2 className="headline text-[clamp(2rem,3.6vw,2.875rem)] leading-[1.05] tracking-[-0.03em] text-balance">
                Rehearse the interview before it’s real.
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-pretty text-muted-foreground">
                A full interview, an HR round, tough questions, a phone screen, a university admission or a student visa interview, for
                your role and experience. The interviewer asks every question aloud and follows up like a real one. Then feedback on what
                you said and how you said it.
              </p>
              <div className="surface mt-8 p-6">
                <InterviewDemo />
              </div>
            </div>
          </div>
        </section>

        {/* Listening, in depth. */}
        <section className="mx-auto max-w-6xl px-4 pt-24 sm:pt-32">
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <img
              src={featureListen}
              alt="A man wearing headphones concentrating on his laptop"
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full rounded-3xl bg-fill object-cover md:order-2"
            />
            <div>
              <h2 className="headline text-[clamp(2rem,3.6vw,2.875rem)] leading-[1.05] tracking-[-0.03em] text-balance">
                Hear the difference first. Then say it.
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-pretty text-muted-foreground">
                It’s hard to say a sound you can’t hear. Short drills play pairs like “think” and “sink” in different voices, so your ear is
                ready for real people, not one recording.
              </p>
            </div>
          </div>
        </section>

        {/* How it works. */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-28 sm:pt-40">
          <SectionTitle title="A few minutes a day." />
          <ol className="mt-14 grid gap-10 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.title} className="border-t border-border pt-6">
                <h3 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-2 text-[16px] leading-relaxed text-pretty text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Closing: a full-width moment. */}
        <section className="mx-auto max-w-6xl px-4 pt-28 pb-24 sm:pt-40 sm:pb-32">
          <div className="dark relative isolate overflow-hidden rounded-3xl bg-black text-white">
            <img
              src={confident}
              alt="A young woman answering an interview question with confidence"
              loading="lazy"
              decoding="async"
              className="aspect-[3/4] w-full object-cover sm:aspect-[16/8]"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/90 via-black/50 to-black/5 p-8 text-center sm:p-14">
              <h2 className="headline max-w-2xl text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.03] tracking-[-0.03em] text-balance">
                Walk in ready to be understood.
              </h2>
              <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-pretty text-white/85">
                Start with a two-minute check-up. The coach finds your trouble sounds and builds your practice around them.
              </p>
              <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
                <Button asChild size="lg" className="h-12 bg-white px-8 text-[16px] text-black hover:bg-white/90">
                  <Link to="/signup">
                    Create a free account <ArrowRightIcon weight="bold" className={ARROW} />
                  </Link>
                </Button>
                <Link
                  to="/login"
                  className="rounded-sm text-[16px] font-medium text-white/90 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
