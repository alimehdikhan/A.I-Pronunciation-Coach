import { ArrowRightIcon, EyeIcon, EyeSlashIcon, ShieldCheckIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Background } from '@/components/layout/Background'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const NAME_RE = /^[\p{L}\p{N}_ .'-]{1,40}$/u
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
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
  const guestName = useSettings((s) => s.username)

  const [name, setName] = useState(signup ? guestName : '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [touched, setTouched] = useState(false)

  const errors = {
    name: signup && !NAME_RE.test(name.trim()) ? 'Use up to 40 letters, numbers, spaces or . \' _ -' : null,
    email: !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null,
    password: signup && password.length < 8 ? 'Use at least 8 characters.' : !password ? 'Enter your password.' : null,
  }
  const invalid = Object.values(errors).some(Boolean)

  const submit = useMutation({
    mutationFn: () =>
      signup
        ? api.register({ email: email.trim(), password, username: name.trim() })
        : api.login({ email: email.trim(), password }),
    meta: { silent: true },
    onSuccess: (profile) => {
      signIn({ username: profile.username, email: profile.email })
      void queryClient.invalidateQueries()
      toast.success(signup ? `Welcome, ${profile.username}` : `Signed in as ${profile.username}`)
      navigate('/', { replace: true })
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!invalid && !submit.isPending) submit.mutate()
  }

  const serverError = submit.error instanceof ApiError ? submit.error.message : submit.error ? 'Something went wrong. Try again.' : null

  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <Background />
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link to="/" aria-label="Back to practice">
            <LogoMark className="size-14 rounded-2xl shadow-[0_12px_40px_-10px_rgb(201_89_221/0.6)]" />
          </Link>
          <h1 className="headline mt-6 text-[30px]">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {signup
              ? guestName
                ? `Your practice history as “${guestName}” moves to your account.`
                : 'Keep your streaks and progress on every device.'
              : 'Sign in to pick up your streaks and history.'}
          </p>
        </div>

        <form onSubmit={onSubmit} noValidate className="surface space-y-4 p-6">
          {signup && (
            <Field label="Display name" error={touched ? errors.name : null}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
                maxLength={40}
                autoFocus={!guestName}
                aria-invalid={touched && !!errors.name}
                className="h-11 rounded-xl text-[15px]"
              />
            </Field>
          )}

          <Field label="Email" error={touched ? errors.email : null}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              autoFocus={!signup || !!guestName}
              aria-invalid={touched && !!errors.email}
              className="h-11 rounded-xl text-[15px]"
            />
          </Field>

          <Field
            label="Password"
            hint={signup ? 'At least 8 characters.' : undefined}
            error={touched ? errors.password : null}
          >
            <div className="relative">
              <Input
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? 'new-password' : 'current-password'}
                maxLength={128}
                aria-invalid={touched && !!errors.password}
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

          <div aria-live="polite" className={cn('min-h-5 text-[13px] text-bad', !serverError && 'hidden')}>
            {serverError}
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
          <Link to="/" className="font-medium text-subtle hover:text-foreground">
            Continue as a guest
          </Link>
        </p>

        <p className="mx-auto mt-8 flex max-w-[320px] items-start gap-2 text-xs leading-relaxed text-subtle">
          <ShieldCheckIcon size={16} className="mt-px shrink-0" />
          Passwords are stored as salted scrypt hashes. There is no email verification or password reset yet, so keep your
          password somewhere safe.
        </p>
      </div>
    </div>
  )
}
