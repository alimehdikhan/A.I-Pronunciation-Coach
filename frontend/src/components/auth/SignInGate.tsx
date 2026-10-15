import { LockKeyIcon, SignInIcon, UserCirclePlusIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** Sign in / create account buttons, shared by every locked view. */
export function SignInActions() {
  return (
    <div className="flex flex-wrap justify-center gap-2.5">
      <Button asChild size="lg" className="h-12 rounded-xl px-6 text-[15px]">
        <Link to="/signup">
          <UserCirclePlusIcon weight="bold" /> Create account
        </Link>
      </Button>
      <Button asChild size="lg" variant="secondary" className="h-12 rounded-xl px-6 text-[15px]">
        <Link to="/login">
          <SignInIcon weight="bold" /> Sign in
        </Link>
      </Button>
    </div>
  )
}

/**
 * Shown to guests in place of their score. The recording is still analysed, so
 * signing in brings the full result straight back (it stays in memory).
 */
export function LockedResults({ children }: { children?: ReactNode }) {
  return (
    <section className="surface relative overflow-hidden">
      {/* Abstract placeholder behind the lock: no real numbers are ever drawn. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center gap-8 p-8 opacity-25 blur-[3px] select-none sm:p-10"
      >
        <Skeleton className="hidden size-40 shrink-0 rounded-full sm:block" />
        <div className="w-full space-y-4">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>

      {/* The content sets the card's height, so nothing can be clipped. */}
      <div className="relative z-10 mx-auto max-w-md px-6 py-10 text-center sm:py-12">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
          <LockKeyIcon size={28} weight="fill" />
        </div>
        <h3 className="headline text-[24px]">Your score is ready</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          Sign in or create a free account to see your score, the word-by-word breakdown and your coach’s tips. Your recording
          is kept, so it shows up as soon as you do.
        </p>
        <div className="mt-6">
          <SignInActions />
        </div>
        {children}
      </div>
    </section>
  )
}
