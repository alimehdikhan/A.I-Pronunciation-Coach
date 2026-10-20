import { ArrowRightIcon, CheckCircleIcon, EyeIcon, EyeSlashIcon, ShieldCheckIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { StorageNotice } from '@/components/auth/StorageNotice'
import { Background } from '@/components/layout/Background'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { keys, useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const NAME_RE = /^[\p{L}\p{N}_ .'-]{1,40}$/u
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/

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

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-bad">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-subtle">{hint}</span>
      )}
    </label>
  )
}

/** Sign in (`/login`) and create account (`/signup`). Guests can keep practising without either. */
export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const signIn = useSettings((s) => s.signIn)
  const continueAsGuest = useSettings((s) => s.continueAsGuest)
  const guestName = useSettings((s) => s.username)

  const [displayName, setDisplayName] = useState(signup ? guestName : '')
  const [username, setUsername] = useState(signup ? guestName : '')
  const [usernameEdited, setUsernameEdited] = useState(!!guestName)
  const [identifier, setIdentifier] = useState('') // login: email or username
  const [email, setEmail] = useState('') // signup
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [touched, setTouched] = useState(false)
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle')

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
    onSuccess: (profile) => {
      // Replace the cached "not signed in" answer first: the account sync in AppShell would
      // otherwise read it as proof that this browser was signed out and rotate its key.
      queryClient.setQueryData(keys.account, profile)
      signIn({ username: profile.username, displayName: profile.display_name, email: profile.email })
      void queryClient.invalidateQueries()
      toast.success(signup ? `Welcome, ${profile.display_name}` : `Signed in as ${profile.display_name}`)
      // A new account is offered the before-and-after baseline (it asks for consent before storing anything).
      navigate(signup ? '/before-after?welcome=1' : '/', { replace: true })
    },
  })

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
  const generalError = !shownElsewhere ? message : null

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!invalid && !submit.isPending) submit.mutate()
  }

  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <Background />
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link to="/" onClick={continueAsGuest} aria-label="Back to practice">
            <LogoMark className="size-14 rounded-2xl shadow-[0_12px_40px_-10px_rgb(201_89_221/0.6)]" />
          </Link>
          <h1 className="headline mt-6 text-[30px]">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {signup
              ? guestName
                ? `Your practice history as “${guestName}” moves to your account.`
                : 'See your scores and keep your progress on every device.'
              : 'Sign in to see your scores, streaks and history.'}
          </p>
        </div>

        <StorageNotice className="mb-4" />

        {/* A real form with named, typed fields: that is what lets the browser offer to save and fill the password. */}
        <form onSubmit={onSubmit} noValidate method="post" className="surface space-y-4 p-6" aria-label={signup ? 'Create account' : 'Sign in'}>
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
                  aria-invalid={!!local.username || !!server.username}
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
                  <Link to="/login" className="font-semibold text-primary hover:underline">
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
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                Create an account
              </Link>
            </p>
          )}

          <Field
            label="Password"
            hint={signup ? 'At least 8 characters. A few random words is stronger than a short mix of symbols.' : undefined}
            error={server.password ?? (touched ? local.password : null)}
          >
            <div className="relative">
              <Input
                name="password"
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? 'new-password' : 'current-password'}
                maxLength={128}
                aria-invalid={(touched && !!local.password) || !!server.password}
                className="h-11 rounded-xl pr-11 text-[15px]"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-subtle transition-colors hover:text-foreground"
              >
                {reveal ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
          </Field>

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

          <div aria-live="polite" className={cn('min-h-5 text-[13px] text-bad', !generalError && 'hidden')}>
            {generalError}
          </div>

          <Button type="submit" size="lg" disabled={submit.isPending} className="h-12 w-full rounded-xl text-[15px]">
            {submit.isPending ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
            {!submit.isPending && <ArrowRightIcon weight="bold" />}
          </Button>
        </form>

        <p className="mt-6 text-center text-[14px] text-muted-foreground">
          {signup ? 'Already have an account?' : 'New here?'}{' '}
          <Link to={signup ? '/login' : '/signup'} className="font-semibold text-primary hover:underline">
            {signup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
        <p className="mt-3 text-center text-[13px]">
          <Link to="/" onClick={continueAsGuest} className="font-medium text-subtle hover:text-foreground">
            Practice without signing in
          </Link>
          <span className="mt-1 block text-xs text-subtle">You will need an account to see your scores.</span>
        </p>

        <p className="mx-auto mt-8 flex max-w-[340px] items-start gap-2 text-xs leading-relaxed text-subtle">
          <ShieldCheckIcon size={16} className="mt-px shrink-0" />
          {health?.password_reset
            ? 'Passwords are stored as salted scrypt hashes. If you forget yours, you can reset it by email.'
            : 'Passwords are stored as salted scrypt hashes. There is no email verification or password reset yet, so keep your password somewhere safe.'}
        </p>
      </div>
    </div>
  )
}
