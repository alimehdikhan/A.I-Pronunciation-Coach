import {
  CaretUpDownIcon,
  FireIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SignInIcon,
  SunIcon,
  UserCircleIcon,
  UserIcon,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, NavLink, useLocation, useNavigate, useOutlet } from 'react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useHeadlineReveal } from '@/lib/gsap'
import { useAccount, useAnalytics } from '@/lib/queries'
import { cn, initials } from '@/lib/utils'
import { applyTheme, useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { Background } from './Background'
import { HealthPill } from './HealthPill'
import { Logo, LogoMark } from './Logo'
import { NAV } from './nav'

// Overlays aren't needed for first paint; load them on demand.
const CommandMenu = lazy(() => import('./CommandMenu').then((m) => ({ default: m.CommandMenu })))
const SettingsDialog = lazy(() => import('./SettingsDialog').then((m) => ({ default: m.SettingsDialog })))
const OnboardingDialog = lazy(() => import('./OnboardingDialog').then((m) => ({ default: m.OnboardingDialog })))
const PhonemeSheet = lazy(() => import('@/components/tutor/PhonemeSheet').then((m) => ({ default: m.PhonemeSheet })))


function useThemeSync() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])
}

/** Keeps this browser's signed-in state in step with the server (e.g. after a password change elsewhere). */
function useAccountSync() {
  const { data } = useAccount()
  const accountEmail = useSettings((s) => s.accountEmail)
  const displayName = useSettings((s) => s.displayName)
  const signIn = useSettings((s) => s.signIn)
  const signOut = useSettings((s) => s.signOut)
  useEffect(() => {
    if (!data) return
    if (data.account && (accountEmail !== data.email || displayName !== data.display_name))
      signIn({ username: data.username, displayName: data.display_name, email: data.email })
    else if (!data.account && accountEmail) signOut()
  }, [data, accountEmail, displayName, signIn, signOut])
}

function useCommandShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const ui = useUI.getState()
        ui.setCommandOpen(!ui.commandOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function useIsDark() {
  const theme = useSettings((s) => s.theme)
  return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function ThemeButton({ className }: { className?: string }) {
  const setTheme = useSettings((s) => s.setTheme)
  const isDark = useIsDark()
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-fill hover:text-foreground',
        className,
      )}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <SunIcon size={17} weight="bold" /> : <MoonIcon size={17} weight="bold" />}
    </button>
  )
}

function StreakCard() {
  const username = useSettings((s) => s.username)
  const { data } = useAnalytics(username)
  if (!username) return null
  const streak = data?.streak_days ?? 0
  return (
    <NavLink to="/progress" className="mx-3 block rounded-2xl bg-fill p-3.5 transition-colors hover:bg-fill-strong">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Streak</span>
        <FireIcon size={16} weight="fill" className={streak ? 'text-[#ff9500]' : 'text-subtle'} />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold tracking-tight">{streak}</span>
        <span className="text-[13px] text-muted-foreground">{streak === 1 ? 'day' : 'days'}</span>
      </div>
      <div className="text-xs text-subtle">{data ? `${data.sessions_this_week} sessions this week` : '—'}</div>
    </NavLink>
  )
}

function ProfileMenu() {
  const username = useSettings((s) => s.displayName || s.username)
  const accountEmail = useSettings((s) => s.accountEmail)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-ring/50">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[11px] font-semibold text-white">
            {username ? initials(username) : <UserIcon size={16} weight="bold" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{username || 'Guest'}</div>
            <div className="truncate text-[11px] text-subtle">
              {accountEmail ?? (username ? 'Progress saved in this browser' : 'Not saving progress')}
            </div>
          </div>
          <CaretUpDownIcon size={14} className="text-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserCircleIcon /> Profile
        </DropdownMenuItem>
        {!accountEmail && (
          <DropdownMenuItem onSelect={() => navigate('/login')}>
            <SignInIcon /> Sign in or create account
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
          <GearSixIcon /> Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Sidebar() {
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  return (
    <aside className="material fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border lg:flex">
      <div className="flex h-14 items-center justify-between pr-3 pl-5">
        <Logo />
      </div>

      <div className="px-3 pt-1">
        <button
          onClick={() => setCommandOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-[9px] bg-fill px-2.5 text-[13px] text-subtle transition-colors hover:bg-fill-strong"
        >
          <MagnifyingGlassIcon size={14} weight="bold" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <nav className="mt-5 flex flex-col gap-0.5 px-3">
        {NAV.map(({ to, label, icon: IconComp }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {({ isActive }) => (
              <div
                className={cn(
                  'relative flex h-8 items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-fill hover:text-foreground',
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-[9px] bg-fill-strong"
                    transition={{ type: 'spring', bounce: 0.12, duration: 0.45 }}
                  />
                )}
                <IconComp size={17} weight={isActive ? 'fill' : 'regular'} className={cn('relative', isActive && 'text-primary')} />
                <span className="relative">{label}</span>
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pb-3">
        <StreakCard />
        <div className="flex items-center justify-between px-3 pt-1">
          <HealthPill />
          <ThemeButton />
        </div>
        <div className="px-1.5">
          <ProfileMenu />
        </div>
      </div>
    </aside>
  )
}

function MobileHeader() {
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const username = useSettings((s) => s.displayName || s.username)
  const accountEmail = useSettings((s) => s.accountEmail)
  return (
    <header className="material sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border px-4 lg:hidden">
      <div className="flex items-center gap-2">
        <LogoMark className="size-7 rounded-[8px]" />
        <span className="text-[15px] font-semibold tracking-tight">Coach</span>
      </div>
      <div className="flex items-center">
        <button onClick={() => setCommandOpen(true)} className="grid size-8 place-items-center rounded-full text-muted-foreground" aria-label="Search">
          <MagnifyingGlassIcon size={18} weight="bold" />
        </button>
        <ThemeButton />
        <button onClick={() => setSettingsOpen(true)} className="grid size-8 place-items-center rounded-full text-muted-foreground" aria-label="Settings">
          <GearSixIcon size={18} weight="bold" />
        </button>
        {accountEmail ? (
          <NavLink
            to="/profile"
            aria-label="Your profile"
            className="ml-1 grid size-8 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[11px] font-semibold text-white"
          >
            {username ? initials(username) : <UserIcon size={16} weight="bold" />}
          </NavLink>
        ) : (
          <NavLink
            to="/login"
            className="ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground"
          >
            <SignInIcon size={15} weight="bold" /> Sign in
          </NavLink>
        )}
      </div>
    </header>
  )
}

function TabBar() {
  return (
    <nav className="material fixed inset-x-0 bottom-0 z-30 border-t border-border pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="grid grid-cols-4">
        {NAV.map(({ to, short, icon: IconComp }) => (
          <NavLink key={to} to={to} end={to === '/'} className="flex flex-col items-center gap-0.5 pt-2 pb-1.5">
            {({ isActive }) => (
              <>
                <IconComp size={24} weight={isActive ? 'fill' : 'regular'} className={isActive ? 'text-primary' : 'text-subtle'} />
                <span className={cn('text-[10px] font-medium', isActive ? 'text-primary' : 'text-subtle')}>{short}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** Keeps showing the page it mounted with, so exiting pages animate out intact. */
function FrozenOutlet() {
  const outlet = useOutlet()
  const [frozen] = useState(outlet)
  return frozen
}

function PageFallback() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-12 w-72 rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-[30px]" />
    </div>
  )
}

/**
 * Someone opening the site for the first time lands on the sign-in page.
 * "Continue as a guest" there (or having used the app before) skips it for good.
 * Deep links such as /sounds are never redirected.
 */
function useEntryGate(pathname: string): boolean {
  const accountEmail = useSettings((s) => s.accountEmail)
  const guestChosen = useSettings((s) => s.guestChosen)
  const onboarded = useSettings((s) => s.onboarded)
  return pathname === '/' && !accountEmail && !guestChosen && !onboarded
}

export function AppShell() {
  useThemeSync()
  useAccountSync()
  useCommandShortcut()
  const location = useLocation()
  const gated = useEntryGate(location.pathname)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  if (gated) return <Navigate to="/login" replace />

  return (
    <div className="relative min-h-dvh">
      <Background />
      <Sidebar />
      <MobileHeader />
      <main className="pb-28 lg:pb-16 lg:pl-[248px]">
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 sm:px-6 lg:px-12 lg:pt-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Suspense fallback={<PageFallback />}>
                <FrozenOutlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <TabBar />
      <Suspense fallback={null}>
        <CommandMenu />
        <SettingsDialog />
        <OnboardingDialog />
        <PhonemeSheet />
      </Suspense>
    </div>
  )
}

/** Large Apple-style page title. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  const headline = useRef<HTMLHeadingElement>(null)
  useHeadlineReveal(headline, [typeof title === 'string' ? title : ''])
  return (
    <div className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-2 text-[13px] font-semibold text-primary">{eyebrow}</div>}
        <h1 ref={headline} className="headline text-[34px] sm:text-[48px]">
          {title}
        </h1>
        {description && <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
