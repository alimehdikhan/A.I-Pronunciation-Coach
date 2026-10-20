import { ChartLineUpIcon, EarIcon, WaveformIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSettings, type Goal, type TipLanguage } from '@/store/settings'
import { NATIVE_LANGUAGES, TIP_LANGUAGES } from './SettingsDialog'
import { LogoMark } from './Logo'

const FEATURES = [
  { icon: WaveformIcon, color: 'text-[#0894ff]', title: 'Sound-level feedback', text: 'See exactly which sounds slipped, not just a score.' },
  { icon: EarIcon, color: 'text-[#c959dd]', title: 'Guided fixes', text: 'Mouth placement, minimal pairs and reference audio for every sound.' },
  { icon: ChartLineUpIcon, color: 'text-[#ff2e54]', title: 'Visible progress', text: 'Streaks, trends and drills built from your own mistakes.' },
]

const USERNAME_RE = /^[\p{L}\p{N}_ .'-]{1,40}$/u

const GOALS: { id: Goal; title: string; text: string }[] = [
  { id: 'understood', title: 'Be clearly understood', text: 'Fix the slips that change what people hear first.' },
  { id: 'accent', title: 'Reduce my accent', text: 'Work on every sound that differs from American English.' },
]

/** Step two: first language, goal and the language for tips. Every choice can be changed in Settings. */
function AboutYou({ onDone }: { onDone: () => void }) {
  const settings = useSettings()
  return (
    <div className="mt-6 space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground" htmlFor="onboard-language">
          Your first language
        </label>
        <Select value={settings.nativeLanguage ?? '__none'} onValueChange={(v) => settings.setNativeLanguage(v === '__none' ? null : v)}>
          <SelectTrigger id="onboard-language" className="h-11 w-full rounded-xl">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-72">
            <SelectItem value="__none">Prefer not to say</SelectItem>
            {NATIVE_LANGUAGES.map((language) => (
              <SelectItem key={language} value={language}>
                {language}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[12px] text-subtle">Puts the sounds usually hard for its speakers first. It never changes a score.</p>
      </div>

      <div role="radiogroup" aria-label="Your goal" className="grid gap-2">
        <div className="text-[13px] font-semibold text-muted-foreground">Your goal</div>
        {GOALS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={settings.goal === g.id}
            onClick={() => settings.setGoal(g.id)}
            className={`rounded-xl border-2 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
              settings.goal === g.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-fill'
            }`}
          >
            <div className="text-[15px] font-semibold">{g.title}</div>
            <div className="text-[13px] text-muted-foreground">{g.text}</div>
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-muted-foreground" htmlFor="onboard-tips">
          Tips in
        </label>
        <Select value={settings.tipLanguage} onValueChange={(v) => settings.setTipLanguage(v as TipLanguage)}>
          <SelectTrigger id="onboard-tips" className="h-11 w-full rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {TIP_LANGUAGES.map((language) => (
              <SelectItem key={language} value={language}>
                {language}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button size="lg" onClick={onDone} className="h-12 w-full rounded-xl text-[15px]">
        Start practising
      </Button>
    </div>
  )
}

export function OnboardingDialog() {
  const onboarded = useSettings((s) => s.onboarded)
  const complete = useSettings((s) => s.completeOnboarding)
  const [name, setName] = useState('')
  const [step, setStep] = useState<'name' | 'about'>('name')
  const [chosenName, setChosenName] = useState<string | undefined>(undefined)
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

        {step === 'about' ? (
          <AboutYou onDone={() => complete(chosenName)} />
        ) : (
          <>
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
                if (!valid) return
                setChosenName(name)
                setStep('about')
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
              <button
                type="button"
                onClick={() => {
                  setChosenName(undefined)
                  setStep('about')
                }}
                className="mt-4 w-full text-[13px] font-medium text-primary hover:underline"
              >
                Continue without saving progress
              </button>
              <p className="mt-3 text-center text-[12px] text-subtle">
                By continuing you agree to the{' '}
                <Link to="/terms" onClick={() => complete()} className="font-medium text-primary hover:underline">
                  Terms
                </Link>{' '}
                and{' '}
                <Link to="/privacy" onClick={() => complete()} className="font-medium text-primary hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
              <p className="mt-3 text-center text-[13px] text-muted-foreground">
                Have an account?{' '}
                <Link to="/login" onClick={() => complete()} className="font-medium text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
