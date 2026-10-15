import { ChartLineUpIcon, EarIcon, WaveformIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/store/settings'
import { LogoMark } from './Logo'

const FEATURES = [
  { icon: WaveformIcon, color: 'text-[#0894ff]', title: 'Sound-level feedback', text: 'See exactly which sounds slipped, not just a score.' },
  { icon: EarIcon, color: 'text-[#c959dd]', title: 'Guided fixes', text: 'Mouth placement, minimal pairs and reference audio for every sound.' },
  { icon: ChartLineUpIcon, color: 'text-[#ff2e54]', title: 'Visible progress', text: 'Streaks, trends and drills built from your own mistakes.' },
]

const USERNAME_RE = /^[\p{L}\p{N}_ .'-]{1,40}$/u

export function OnboardingDialog() {
  const onboarded = useSettings((s) => s.onboarded)
  const complete = useSettings((s) => s.completeOnboarding)
  const [name, setName] = useState('')
  const valid = USERNAME_RE.test(name.trim())

  return (
    <Dialog open={!onboarded} onOpenChange={(open) => !open && complete()}>
      <DialogContent showCloseButton={false} className="gap-0 p-8 sm:max-w-[440px]">
        <div className="flex flex-col items-center text-center">
          <LogoMark className="size-16 rounded-[18px] shadow-[0_12px_40px_-10px_rgb(201_89_221/0.6)]" />
          <DialogTitle className="headline mt-6 text-[28px]">
            Welcome to <span className="text-ai">Coach</span>
          </DialogTitle>
          <DialogDescription className="mt-2 text-[15px]">
            Speak a phrase. Your AI coach pinpoints every sound that needs work.
          </DialogDescription>
        </div>

        <div className="mt-8 space-y-5">
          {FEATURES.map(({ icon: IconComp, color, title, text }) => (
            <div key={title} className="flex gap-4">
              <IconComp size={30} weight="duotone" className={`shrink-0 ${color}`} />
              <div>
                <div className="text-[15px] font-semibold">{title}</div>
                <div className="text-[13px] leading-snug text-muted-foreground">{text}</div>
              </div>
            </div>
          ))}
        </div>

        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) complete(name)
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            aria-label="Your name"
            className="h-12 rounded-xl text-center text-[15px]"
          />
          <Button type="submit" size="lg" disabled={!valid} className="mt-3 h-12 w-full rounded-xl text-[15px]">
            Continue
          </Button>
          <button type="button" onClick={() => complete()} className="mt-4 w-full text-[13px] font-medium text-primary hover:underline">
            Continue without saving progress
          </button>
          <p className="mt-3 text-center text-[13px] text-muted-foreground">
            Have an account?{' '}
            <Link to="/login" onClick={() => complete()} className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
