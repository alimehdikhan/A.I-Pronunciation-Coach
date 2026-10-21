import { ArrowRightIcon, CheckCircleIcon, EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Background } from '@/components/layout/Background'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useHealth } from '@/lib/queries'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <Background />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark className="size-14" />
          <h1 className="headline mt-5 text-[28px]">{title}</h1>
        </div>
        {children}
        <p className="mt-6 text-center text-[14px] text-muted-foreground">
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

/** "Forgot password?": asks for the email and sends a single-use link (only when the server can send email). */
export function ForgotPage() {
  const { data: health } = useHealth()
  const [email, setEmail] = useState('')
  const send = useMutation({ mutationFn: () => api.forgotPassword(email.trim()), meta: { silent: true } })
  if (health && !health.password_reset) {
    return (
      <Shell title="Password reset">
        <p className="surface p-6 text-[15px]">This server can't send email, so passwords can't be reset here.</p>
      </Shell>
    )
  }
  return (
    <Shell title="Reset your password">
      {send.isSuccess ? (
        <div className="surface flex gap-3 p-6 text-[15px]" role="status">
          <EnvelopeSimpleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-primary" />
          {send.data.detail}
        </div>
      ) : (
        <form
          className="surface space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) send.mutate()
          }}
        >
          <label className="block text-[13px] font-semibold text-muted-foreground" htmlFor="forgot-email">
            Your account's email
          </label>
          <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl" />
          {send.error && <p className="text-[13px] text-bad">{send.error instanceof Error ? send.error.message : 'Could not send.'}</p>}
          <Button type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={!email.trim() || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send reset link'} <ArrowRightIcon weight="bold" />
          </Button>
        </form>
      )}
    </Shell>
  )
}

/** The page a reset email links to: choose a new password. */
export function ResetPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const reset = useMutation({ mutationFn: () => api.resetPassword(token, password), meta: { silent: true } })
  return (
    <Shell title="Choose a new password">
      {reset.isSuccess ? (
        <div className="surface flex gap-3 p-6 text-[15px]" role="status">
          <CheckCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-good" />
          Your password was changed, and every device was signed out. Sign in with the new password.
        </div>
      ) : (
        <form
          className="surface space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) reset.mutate()
          }}
        >
          <label className="block text-[13px] font-semibold text-muted-foreground" htmlFor="new-password">
            New password (at least 8 characters)
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={128}
            className="h-11 rounded-xl"
          />
          {!token && <p className="text-[13px] text-bad">This link is missing its code. Open the link from the email again.</p>}
          {reset.error && <p className="text-[13px] text-bad">{reset.error instanceof Error ? reset.error.message : 'Could not reset.'}</p>}
          <Button type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={!token || password.length < 8 || reset.isPending}>
            {reset.isPending ? 'Saving…' : 'Set new password'} <ArrowRightIcon weight="bold" />
          </Button>
        </form>
      )}
    </Shell>
  )
}
