import {
  ArrowRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { StorageNotice } from '@/components/auth/StorageNotice'
import { LegalLinks } from '@/components/site/LegalLinks'
import { Background } from '@/components/layout/Background'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import type { AccountProfile } from '@/lib/types'
import { keys, useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const NAME_RE = /^[\p{L}\p{N}_ .'-]{1,40}$/u
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/

/** Where to go after signing in: only a page inside the app, never another site or the sign-in pages. */
function safeNext(path: string | null): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  if (path.startsWith('/api/') || /^\/(login|signup|forgot|reset)\b/.test(path)) return null
  return path
}

/** What went wrong on the way back from Google (the server puts a code in `?error=`). */
const GOOGLE_ERRORS: Record<string, string> = {
  google_expired: 'That Google sign-in took too long or was already used. Please try again.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google couldn’t confirm your account. Try again, or use your email and password.',
  google_unverified: 'Your Google email address isn’t verified, so it can’t be used here. Use your email and password instead.',
}

/** A starting username from a display name: "Sam Lee" -> "sam.lee". */
function suggestUsername(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30)
}

/** 0-4. Length matters most; mixing character kinds and avoiding repeats helps. */
function strength(password: string): { score: number; label: string; tone: string } {
  if (!password) return { score: 0, label: '', tone: '' }
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  if (kinds >= 3 || password.length >= 16) score++
  if (new Set(password.toLowerCase()).size < Math.min(6, password.length / 2)) score = Math.min(score, 1)
  if (password.length < 8) score = 0
  const labels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong']
  const tones = ['bg-bad', 'bg-bad', 'bg-warn', 'bg-good', 'bg-good']
  const final = Math.min(4, score + (score >= 3 && password.length >= 14 ? 1 : 0))
  return { score: final, label: labels[final], tone: tones[final] }
}

function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs text-bad">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-subtle">{hint}</span>
      )}
    </label>
  )
}

/** Google's "G", in its own colours (as Google's sign-in branding asks). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Sign in (`/login`) and create account (`/signup`). The app itself needs an account. */
export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const signIn = useSettings((s) => s.signIn)
  const guestName = useSettings((s) => s.username)
  // Read once: signing in on this page sets it, and then this page navigates on its own.
  const [alreadySignedIn] = useState(() => !!useSettings.getState().accountEmail)

  const next = safeNext(params.get('next'))
  const keepNext = next ? `?next=${encodeURIComponent(next)}` : ''
  const googleReturn = params.get('signed_in') === 'google'
  const googleProblem = GOOGLE_ERRORS[params.get('error') ?? ''] ?? null

  const [displayName, setDisplayName] = useState(signup ? guestName : '')
  const [username, setUsername] = useState(signup ? guestName : '')
  const [usernameEdited, setUsernameEdited] = useState(!!guestName)
  const [identifier, setIdentifier] = useState('') // login: email or username
  const [email, setEmail] = useState('') // signup
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [touched, setTouched] = useState(false)
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle')
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(googleProblem)

  useEffect(() => {
    document.title = signup ? 'Create your account · Vocaly AI' : 'Sign in · Vocaly AI'
  }, [signup])

  /** Signed in: remember the account in this browser and go where the learner was heading. */
  const finish = (profile: Extract<AccountProfile, { account: true }>, how: 'login' | 'signup' | 'google') => {
    // Replace the cached "not signed in" answer first: the account sync in AppShell would
    // otherwise read it as proof that this browser was signed out and rotate its key.
    queryClient.setQueryData(keys.account, profile)
    signIn({ username: profile.username, displayName: profile.display_name, email: profile.email })
    void queryClient.invalidateQueries()
    toast.success(how === 'signup' ? `Welcome, ${profile.display_name}` : `Signed in as ${profile.display_name}`)
    // A new account is offered the before-and-after baseline (it asks for consent before storing anything),
    // unless the learner was on their way to a particular page.
    const welcome = how === 'signup' && (!next || next === '/practice')
    navigate(welcome ? '/before-after?welcome=1' : (next ?? '/practice'), { replace: true })
  }

  // Back from Google: the server has already bound this browser to the account; pick it up.
  useEffect(() => {
    if (!googleReturn) return
    let cancelled = false
    api
      .me()
      .then((profile) => {
        if (cancelled) return
        if (profile.account) finish(profile, 'google')
        else {
          setGoogleError(GOOGLE_ERRORS.google_failed)
          navigate(`/login${keepNext}`, { replace: true })
        }
      })
      .catch(() => {
        if (cancelled) return
        setGoogleError(GOOGLE_ERRORS.google_failed)
        navigate(`/login${keepNext}`, { replace: true })
      })
    return () => {
      cancelled = true
    }
    // Once, on the way back from Google.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleReturn])

  // Is the chosen username already used? Say so while typing, not after a failed submit.
  useEffect(() => {
    const name = username.trim()
    if (!signup || !NAME_RE.test(name)) {
      setAvailability('idle')
      return
    }
    setAvailability('checking')
    let cancelled = false
    const timer = window.setTimeout(() => {
      api
        .available(name)
        .then((r) => !cancelled && setAvailability(r.available ? 'free' : 'taken'))
        .catch(() => !cancelled && setAvailability('idle'))
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [signup, username])

  const meter = useMemo(() => strength(password), [password])

  const local = {
    displayName:
      signup && displayName.trim() && !NAME_RE.test(displayName.trim()) ? "Use up to 40 letters, numbers, spaces or . ' _ -" : null,
    username: signup
      ? !NAME_RE.test(username.trim())
        ? "Use up to 40 letters, numbers, spaces or . ' _ -"
        : availability === 'taken'
          ? 'That username is already used. Choose another one.'
          : null
      : null,
    identifier: !signup && !identifier.trim() ? 'Enter your email or username.' : null,
    email: signup && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null,
    password: signup && password.length < 8 ? 'Use at least 8 characters.' : !password ? 'Enter your password.' : null,
  }
  const invalid = Object.values(local).some(Boolean)

  const { data: health } = useHealth()
  const submit = useMutation({
    mutationFn: () =>
      signup
        ? api.register({
            email: email.trim(),
            password,
            username: username.trim(),
            display_name: displayName.trim() || undefined,
          })
        : api.login({ identifier: identifier.trim(), password }),
    meta: { silent: true },
    onSuccess: (profile) => finish(profile, signup ? 'signup' : 'login'),
  })

  const continueWithGoogle = () => {
    setGoogleBusy(true)
    setGoogleError(null)
    api
      .googleStart(next ?? '/practice')
      .then(({ url }) => window.location.assign(url))
      .catch((error: unknown) => {
        setGoogleBusy(false)
        setGoogleError(error instanceof ApiError ? error.message : 'Google sign-in isn’t available right now.')
      })
  }

  // Put the server's answer next to the field it is about.
  const code = submit.error instanceof ApiError ? submit.error.code : undefined
  const message = submit.error instanceof ApiError ? submit.error.message : submit.error ? 'Something went wrong. Try again.' : null
  const server = {
    identifier: code === 'no_account' || code === 'identifier_required' ? message : null,
    password: code === 'wrong_password' || code === 'weak_password' ? message : null,
    email: code === 'email_taken' || code === 'invalid_email' ? message : null,
    username: code === 'username_taken' || code === 'username_required' ? message : null,
  }
  const shownElsewhere = Object.values(server).some(Boolean)
  const generalError = (!shownElsewhere ? message : null) ?? googleError

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!invalid && !submit.isPending) submit.mutate()
  }

  const watchCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'))

  if (alreadySignedIn && !googleReturn) return <Navigate to={next ?? '/practice'} replace />

  if (googleReturn && !googleError) {
    return (
      <div className="relative grid min-h-dvh place-items-center px-4">
        <Background />
        <div role="status" className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="size-14" />
          <p className="flex items-center gap-2 text-[15px] text-muted-foreground">
            <SpinnerGapIcon className="motion-safe:animate-spin" /> Signing you in…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <Background />
      <main className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link to="/" aria-label="Vocaly AI home">
            <LogoMark className="size-14 drop-shadow-[0_10px_24px_rgb(79_70_229/0.45)]" />
          </Link>
          <h1 className="headline mt-6 text-[30px]">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {signup
              ? guestName
                ? `Your practice history as “${guestName}” moves to your account.`
                : 'It’s free. Your scores and progress are saved to your account.'
              : 'Sign in to keep practising.'}
          </p>
        </div>

        <StorageNotice className="mb-4" />

        <div className="surface p-6">
          {health?.google_sign_in && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={continueWithGoogle}
                disabled={googleBusy}
                className="h-12 w-full gap-2.5 rounded-xl text-[15px]"
              >
                {googleBusy ? <SpinnerGapIcon className="motion-safe:animate-spin" /> : <GoogleMark />}
                Continue with Google
              </Button>
              <div className="my-5 flex items-center gap-3 text-xs text-subtle" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                or with your email
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {/* A real form with named, typed fields: that is what lets the browser offer to save and fill the password. */}
          <form
            onSubmit={onSubmit}
            noValidate
            method="post"
            className="space-y-4"
            aria-label={signup ? 'Create account' : 'Sign in'}
          >
            {signup ? (
              <>
                <Field
                  label="Display name"
                  hint="Shown on your profile. Other people can use the same name."
                  error={touched ? local.displayName : null}
                >
                  <Input
                    name="name"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value)
                      if (!usernameEdited) setUsername(suggestUsername(e.target.value))
                    }}
                    autoComplete="name"
                    maxLength={40}
                    autoFocus={!guestName}
                    aria-invalid={touched && !!local.displayName}
                    className="h-11 rounded-xl text-[15px]"
                  />
                </Field>

                <Field
                  label="Username"
                  hint={
                    availability === 'checking' ? (
                      'Checking…'
                    ) : availability === 'free' ? (
                      <span className="inline-flex items-center gap-1 text-good">
                        <CheckCircleIcon size={13} weight="fill" /> Available
                      </span>
                    ) : (
                      'Unique to you. Your practice history is stored under it.'
                    )
                  }
                  error={server.username ?? (username.trim() && local.username ? local.username : touched ? local.username : null)}
                >
                  <Input
                    name="handle"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setUsernameEdited(true)
                    }}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={40}
                    aria-invalid={((touched || !!username.trim()) && !!local.username) || !!server.username}
                    className="h-11 rounded-xl text-[15px]"
                  />
                </Field>

                <Field label="Email" error={server.email ?? (touched ? local.email : null)}>
                  <Input
                    name="username"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    inputMode="email"
                    autoCapitalize="none"
                    maxLength={254}
                    aria-invalid={(touched && !!local.email) || !!server.email}
                    className="h-11 rounded-xl text-[15px]"
                  />
                </Field>
                {code === 'email_taken' && (
                  <p className="-mt-2 text-xs">
                    <Link to={`/login${keepNext}`} className="font-semibold text-primary hover:underline">
                      Sign in with that email instead
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <Field label="Email or username" error={server.identifier ?? (touched ? local.identifier : null)}>
                <Input
                  name="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={254}
                  autoFocus
                  aria-invalid={(touched && !!local.identifier) || !!server.identifier}
                  className="h-11 rounded-xl text-[15px]"
                />
              </Field>
            )}
            {code === 'no_account' && (
              <p className="-mt-2 text-xs">
                <Link to={`/signup${keepNext}`} className="font-semibold text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            )}

            <Field
              label="Password"
              hint={
                capsLock ? (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <WarningCircleIcon size={13} weight="fill" /> Caps Lock is on
                  </span>
                ) : signup ? (
                  'At least 8 characters. A few random words is stronger than a short mix of symbols.'
                ) : undefined
              }
              error={server.password ?? (touched ? local.password : null)}
            >
              <div className="relative">
                <Input
                  name="password"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={watchCaps}
                  onKeyUp={watchCaps}
                  onBlur={() => setCapsLock(false)}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  maxLength={128}
                  aria-invalid={(touched && !!local.password) || !!server.password}
                  className="h-11 rounded-xl pr-11 text-[15px]"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  aria-pressed={reveal}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-subtle transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {reveal ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>
            </Field>
            {code === 'use_google' && health?.google_sign_in && (
              <p className="-mt-2 text-xs">
                <button type="button" onClick={continueWithGoogle} className="font-semibold text-primary hover:underline">
                  Continue with Google
                </button>
              </p>
            )}

            {signup && password && (
              <div aria-live="polite" className="-mt-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={cn('h-1.5 flex-1 rounded-full bg-fill-strong', meter.score >= n && meter.tone)} />
                  ))}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">{meter.label}</div>
              </div>
            )}

            {!signup && health?.password_reset && (
              <div className="-mt-1 text-right">
                <Link to="/forgot" className="text-[13px] font-medium text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
            )}

            <div aria-live="polite" className={cn('flex items-start gap-2 text-[13px] text-bad', !generalError && 'hidden')}>
              <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
              <span>{generalError}</span>
            </div>

            {signup && (
              <p className="text-[12px] leading-relaxed text-subtle">
                By creating an account you agree to the{' '}
                <Link to="/terms" className="font-medium text-primary hover:underline">
                  Terms of Use
                </Link>{' '}
                and the{' '}
                <Link to="/privacy" className="font-medium text-primary hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            )}

            <Button type="submit" size="lg" disabled={submit.isPending} className="h-12 w-full rounded-xl text-[15px]">
              {submit.isPending ? (
                <>
                  <SpinnerGapIcon className="motion-safe:animate-spin" /> {signup ? 'Creating your account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {signup ? 'Create account' : 'Sign in'} <ArrowRightIcon weight="bold" />
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[14px] text-muted-foreground">
          {signup ? 'Already have an account?' : 'New to Vocaly AI?'}{' '}
          <Link to={`${signup ? '/login' : '/signup'}${keepNext}`} className="font-semibold text-primary hover:underline">
            {signup ? 'Sign in' : 'Create a free account'}
          </Link>
        </p>

        <LegalLinks className="mt-6 justify-center" />

        {!health?.password_reset && (
          <p className="mx-auto mt-4 max-w-[340px] text-center text-xs leading-relaxed text-subtle">
            There is no password reset yet, so keep your password somewhere safe.
          </p>
        )}
      </main>
    </div>
  )
}
