import {
  CalendarBlankIcon,
  DevicesIcon,
  FireIcon,
  KeyIcon,
  SignInIcon,
  SignOutIcon,
  TargetIcon,
  TrashIcon,
  TrophyIcon,
  UserCirclePlusIcon,
} from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Pill, SectionLabel } from '@/components/common'
import { PageHeader } from '@/components/layout/AppShell'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { keys, useAccount, useAnalytics } from '@/lib/queries'
import { initials } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const NAME_RE = /^[\p{L}\p{N}_ .'-]{1,40}$/u

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-fill p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  )
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="surface p-6 sm:p-8">
      <SectionLabel>{title}</SectionLabel>
      {description && <p className="-mt-2 mb-5 text-[14px] leading-relaxed text-muted-foreground">{description}</p>}
      {children}
    </section>
  )
}

function Hero({ name, email, guest, since }: { name: string; email?: string | null; guest: boolean; since?: string | null }) {
  return (
    <section className="surface flex flex-wrap items-center gap-5 p-6 sm:p-8">
      <div className="grid size-[72px] shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[26px] font-semibold text-white">
        {name ? initials(name) : '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="headline truncate text-[28px]">{name || 'Guest'}</h2>
          <Pill tone={guest ? 'neutral' : 'primary'}>{guest ? 'Guest' : 'Account'}</Pill>
        </div>
        <div className="mt-1 text-[15px] text-muted-foreground">{email ?? 'Progress is saved in this browser only'}</div>
        {since && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-subtle">
            <CalendarBlankIcon size={14} /> Member since{' '}
            {new Date(since).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        )}
      </div>
    </section>
  )
}

function GuestPrompt() {
  return (
    <section className="surface flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div>
        <h3 className="text-[17px] font-semibold">Keep your progress on every device</h3>
        <p className="mt-1.5 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
          An account lets you open your history, streaks and drills on any browser. Your current practice history is kept when
          you sign up.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button asChild size="lg" className="rounded-xl">
          <Link to="/signup">
            <UserCirclePlusIcon weight="bold" /> Create account
          </Link>
        </Button>
        <Button asChild size="lg" variant="secondary" className="rounded-xl">
          <Link to="/login">
            <SignInIcon weight="bold" /> Sign in
          </Link>
        </Button>
      </div>
    </section>
  )
}

function RenameForm({ current }: { current: string }) {
  const queryClient = useQueryClient()
  const signIn = useSettings((s) => s.signIn)
  const email = useSettings((s) => s.accountEmail) ?? ''
  const [name, setName] = useState(current)
  useEffect(() => setName(current), [current])
  const valid = NAME_RE.test(name.trim())

  const rename = useMutation({
    mutationFn: () => api.rename(name.trim()),
    meta: { silent: true },
    onSuccess: (profile) => {
      signIn({ username: profile.username, email: profile.email || email })
      void queryClient.invalidateQueries()
      toast.success('Display name updated')
    },
  })

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        if (valid && name.trim() !== current) rename.mutate()
      }}
      className="flex flex-wrap items-start gap-3"
    >
      <div className="min-w-[220px] flex-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          aria-label="Display name"
          aria-invalid={!valid}
          className="h-11 rounded-xl text-[15px]"
        />
        {rename.error && <p className="mt-1.5 text-xs text-bad">{errorText(rename.error)}</p>}
      </div>
      <Button type="submit" size="lg" variant="secondary" disabled={!valid || name.trim() === current || rename.isPending} className="h-11 rounded-xl">
        Save
      </Button>
    </form>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: () => api.changePassword({ current_password: current, new_password: next }),
    meta: { silent: true },
    onSuccess: () => {
      setCurrent('')
      setNext('')
      void queryClient.invalidateQueries({ queryKey: keys.account })
      toast.success('Password changed. Your other devices were signed out.')
    },
  })
  const ready = current.length > 0 && next.length >= 8

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) change.mutate()
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <Input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
        aria-label="Current password"
        className="h-11 rounded-xl text-[15px]"
      />
      <Input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="New password (8+ characters)"
        autoComplete="new-password"
        aria-label="New password"
        className="h-11 rounded-xl text-[15px]"
      />
      <div className="sm:col-span-2">
        {change.error && <p className="mb-3 text-xs text-bad">{errorText(change.error)}</p>}
        <Button type="submit" size="lg" variant="secondary" disabled={!ready || change.isPending} className="h-11 rounded-xl">
          <KeyIcon weight="bold" /> Change password
        </Button>
      </div>
    </form>
  )
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  needsPassword,
  onConfirm,
  pending,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  needsPassword?: boolean
  onConfirm: (password: string) => void
  pending: boolean
  error?: unknown
}) {
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (!open) setPassword('')
  }, [open])
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {needsPassword && (
          <div>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              aria-label="Your password"
              className="h-11 rounded-xl text-[15px]"
            />
            {error ? <p className="mt-1.5 text-xs text-bad">{errorText(error)}</p> : null}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || (needsPassword && !password)}
            onClick={(e) => {
              e.preventDefault() // stay open until the request finishes
              onConfirm(password)
            }}
          >
            {pending ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const username = useSettings((s) => s.username)
  const signOutLocal = useSettings((s) => s.signOut)
  const { data: account, isLoading } = useAccount()
  const { data: stats } = useAnalytics(username)
  const [confirm, setConfirm] = useState<'history' | 'account' | null>(null)

  const signedIn = account?.account === true
  const profile = account?.account ? account : null

  const logout = useMutation({
    mutationFn: api.logout,
    meta: { silent: true },
    onSettled: () => {
      signOutLocal()
      void queryClient.invalidateQueries()
      toast.success('Signed out')
      navigate('/', { replace: true })
    },
  })

  const clearHistory = useMutation({
    mutationFn: () => api.resetHistory(username),
    meta: { silent: true },
    onSuccess: (r) => {
      setConfirm(null)
      void queryClient.invalidateQueries()
      toast.success(r.deleted ? `Deleted ${r.deleted} attempts` : 'There was nothing to delete')
    },
  })

  const removeAccount = useMutation({
    mutationFn: (password: string) => api.deleteAccount(password),
    meta: { silent: true },
    onSuccess: () => {
      setConfirm(null)
      signOutLocal()
      void queryClient.invalidateQueries()
      toast.success('Your account was deleted')
      navigate('/', { replace: true })
    },
  })

  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title={signedIn ? 'Your account' : 'Your profile'}
        description={
          signedIn
            ? 'Manage your name, password and the devices signed in to your account.'
            : 'You are practising as a guest. Create an account to keep your progress everywhere.'
        }
      />

      <div className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-32 w-full rounded-[30px]" />
        ) : (
          <Hero
            name={profile?.username ?? username}
            email={profile?.email}
            guest={!signedIn}
            since={profile?.member_since}
          />
        )}

        {!isLoading && !signedIn && <GuestPrompt />}

        {username && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={<TargetIcon weight="fill" />} label="Attempts" value={stats?.total_practice_sessions ?? '—'} />
            <Stat icon={<TrophyIcon weight="fill" />} label="Best score" value={stats ? Math.round(stats.best_score) : '—'} />
            <Stat icon={<FireIcon weight="fill" />} label="Streak" value={stats ? `${stats.streak_days}d` : '—'} />
            <Stat icon={<DevicesIcon weight="fill" />} label={signedIn ? 'Devices' : 'Practice days'} value={signedIn ? (profile?.devices ?? '—') : (stats?.practice_days ?? '—')} />
          </section>
        )}

        {signedIn && (
          <>
            <Card title="Display name" description="This is the name shown on your profile and saved with your attempts.">
              <RenameForm current={profile!.username} />
            </Card>

            <Card title="Password" description="Changing it signs out every other device.">
              <PasswordForm />
            </Card>

            <Card title="Session">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-[14px] text-muted-foreground">Signed in as {profile!.email} on {profile!.devices} {profile!.devices === 1 ? 'device' : 'devices'}.</p>
                <Button variant="secondary" size="lg" className="h-11 rounded-xl" disabled={logout.isPending} onClick={() => logout.mutate()}>
                  <SignOutIcon weight="bold" /> Sign out of this device
                </Button>
              </div>
            </Card>
          </>
        )}

        {username && (
          <Card title="Your data">
            <div className="divide-y divide-border">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
                <div>
                  <div className="text-[15px] font-medium">Delete practice history</div>
                  <div className="text-[13px] text-muted-foreground">Removes every attempt and resets your trends. Your {signedIn ? 'account' : 'name'} stays.</div>
                </div>
                <Button variant="secondary" className="rounded-xl" onClick={() => setConfirm('history')}>
                  <TrashIcon weight="bold" /> Delete history
                </Button>
              </div>
              {signedIn && (
                <div className="flex flex-wrap items-center justify-between gap-4 pt-5">
                  <div>
                    <div className="text-[15px] font-medium text-bad">Delete account</div>
                    <div className="text-[13px] text-muted-foreground">Permanently removes your account, history and sign-ins. This cannot be undone.</div>
                  </div>
                  <Button variant="destructive" className="rounded-xl" onClick={() => setConfirm('account')}>
                    Delete account
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'history'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete all practice history?"
        description="Every saved attempt is removed and your progress charts start again. This cannot be undone."
        confirmLabel="Delete history"
        onConfirm={() => clearHistory.mutate()}
        pending={clearHistory.isPending}
      />
      <ConfirmDialog
        open={confirm === 'account'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete your account?"
        description="Your account, practice history and every signed-in device are removed for good. Enter your password to confirm."
        confirmLabel="Delete account"
        needsPassword
        onConfirm={(password) => removeAccount.mutate(password)}
        pending={removeAccount.isPending}
        error={removeAccount.error}
      />
    </>
  )
}
