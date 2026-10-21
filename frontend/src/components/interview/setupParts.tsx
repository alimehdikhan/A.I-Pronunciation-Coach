import { ArrowLeftIcon, ArrowRightIcon, CaretDownIcon, MicrophoneIcon, SpinnerGapIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Segmented } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useInterviewPrefs, type InterviewMode } from '@/store/interview'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

export const LEVEL_SHORT: Record<string, string> = { fresher: 'Fresher', mid: 'Experienced', senior: 'Senior' }
export const MINUTES: Record<number, string> = { 3: 'About 5 minutes', 5: 'About 10 minutes', 7: 'About 15 minutes' }

const MODES: { id: InterviewMode; title: string; text: string }[] = [
  {
    id: 'interview',
    title: 'Real interview',
    text: 'Like the real thing: the interviewer listens, asks follow-up questions about your answers, and your feedback comes at the end.',
  },
  { id: 'practice', title: 'Practice', text: 'Tips before you answer and feedback after every answer. Retry any question.' },
]

/** "Step 2 of 3", a short progress bar, what this step asks, and a way back. */
export function StepHeader({
  index,
  total,
  title,
  hint,
  onBack,
}: {
  index: number
  total: number
  title: string
  hint?: ReactNode
  onBack?: () => void
}) {
  return (
    <div className="mb-6">
      <div className="flex h-8 items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground tabular-nums">
          Step {index + 1} of {total}
        </span>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="-mr-2">
            <ArrowLeftIcon weight="bold" /> Back
          </Button>
        )}
      </div>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', i <= index ? 'bg-primary' : 'bg-fill-strong')} />
        ))}
      </div>
      <h2 className="mt-5 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[28px]">{title}</h2>
      {hint && <div className="mt-1.5 text-[15px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** One step's content, sliding in when the step changes. */
export function StepBody({ step, children }: { step: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, transform: 'translateX(12px)' }}
        animate={{ opacity: 1, transform: 'translateX(0px)' }}
        exit={{ opacity: 0, transform: 'translateX(-8px)' }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** The button that moves a step on. */
export function ContinueBar({ onContinue, label = 'Continue', children }: { onContinue: () => void; label?: string; children?: ReactNode }) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-[13px] text-muted-foreground">{children}</div>
      <Button size="lg" className="h-12 px-7 text-[15px]" onClick={onContinue}>
        {label} <ArrowRightIcon weight="bold" />
      </Button>
    </div>
  )
}

/** A choice card backed by a real radio input, so arrow keys and screen readers work as expected. */
export function Choice({
  name,
  checked,
  onChange,
  className,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'relative cursor-pointer rounded-2xl border-2 transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.98]',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/50',
        checked ? 'border-primary bg-primary-soft' : 'border-border hover:bg-fill',
        className,
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  )
}

export function Field({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="text-[17px] font-semibold tracking-[-0.01em]">{title}</legend>
      {hint && <p className="mt-0.5 text-[14px] text-muted-foreground">{hint}</p>}
      <div className="mt-3.5">{children}</div>
    </fieldset>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={cn('flex items-center justify-between gap-4 py-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

export function LevelChoice({ levels }: { levels: { id: string; label: string }[] }) {
  const prefs = useInterviewPrefs()
  return (
    <Field title="Your experience">
      <Segmented
        layoutId="interview-level"
        value={prefs.level}
        onChange={(level) => prefs.set({ level })}
        options={levels.map((l) => ({ value: l.id, label: LEVEL_SHORT[l.id] ?? l.label }))}
      />
      <p className="mt-2 text-[13px] text-muted-foreground">{levels.find((l) => l.id === prefs.level)?.label}</p>
    </Field>
  )
}

export function LengthChoice({ counts }: { counts: number[] }) {
  const prefs = useInterviewPrefs()
  return (
    <Field title="How long?">
      <Segmented
        layoutId="interview-count"
        value={String(prefs.count)}
        onChange={(count) => prefs.set({ count: Number(count) })}
        options={counts.map((n) => ({ value: String(n), label: `${n} questions` }))}
      />
      <p className="mt-2 text-[13px] text-muted-foreground">{MINUTES[prefs.count] ?? ''}</p>
    </Field>
  )
}

/** Experience and length, side by side. */
export function LevelAndLength({ levels, counts, showLevel = true }: { levels: { id: string; label: string }[]; counts: number[]; showLevel?: boolean }) {
  return (
    <div className="grid gap-9 md:grid-cols-2">
      {showLevel && <LevelChoice levels={levels} />}
      <LengthChoice counts={counts} />
    </div>
  )
}

/** Real interview or practice. */
export function ModeChoice() {
  const prefs = useInterviewPrefs()
  return (
    <Field title="How should it feel?">
      <div role="radiogroup" aria-label="Interview style" className="grid gap-2.5 sm:grid-cols-2">
        {MODES.map((m) => (
          <Choice key={m.id} name="interview-mode" checked={prefs.mode === m.id} onChange={() => prefs.set({ mode: m.id })} className="p-4">
            <span className="block text-[15px] font-semibold">{m.title}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{m.text}</span>
          </Choice>
        ))}
      </div>
    </Field>
  )
}

/** Real interview or practice, then the finer options, folded away: the defaults suit most people. */
export function StyleAndOptions() {
  return (
    <>
      <ModeChoice />
      <MoreOptions />
    </>
  )
}

/** The finer options behind one row that says what is on. */
export function MoreOptions() {
  const prefs = useInterviewPrefs()
  const [open, setOpen] = useState(false)
  const summary = [
    prefs.readAloud ? 'Questions read aloud' : 'Questions as text',
    prefs.handsFree ? `hands-free (${prefs.patience} pause)` : 'you start and stop the mic',
    prefs.readAloud && prefs.fastSpeech ? 'faster voice' : null,
    prefs.mode === 'practice' && prefs.thinkSeconds > 0 ? `${prefs.thinkSeconds} s to think` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-fill px-4 py-3.5 text-left transition-colors outline-none hover:bg-fill-strong focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-medium">More options</span>
          <span className="block truncate text-[13px] text-muted-foreground first-letter:uppercase">{summary}</span>
        </span>
        <CaretDownIcon size={18} weight="bold" className={cn('shrink-0 text-subtle transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 divide-y divide-border rounded-2xl bg-fill px-4">
              <Toggle
                label="Read questions aloud"
                hint="The interviewer speaks every question, as in a real interview."
                checked={prefs.readAloud}
                onChange={(readAloud) => prefs.set({ readAloud })}
              />
              <Toggle
                label="A faster interviewer"
                hint="Real interviewers speak quickly. Practise following natural speed."
                checked={prefs.fastSpeech}
                onChange={(fastSpeech) => prefs.set({ fastSpeech })}
                disabled={!prefs.readAloud}
              />
              <Toggle
                label="Show the question as text"
                hint="Turn off to practise listening, like on a phone call."
                checked={prefs.showText || !prefs.readAloud}
                onChange={(showText) => prefs.set({ showText })}
                disabled={!prefs.readAloud}
              />
              <Toggle
                label="Hands-free"
                hint={
                  prefs.mode === 'interview'
                    ? 'Your mic opens after each question and closes when you pause. The interviewer replies straight away, with a follow-up or the next question.'
                    : 'Your mic opens after each question and closes when you pause.'
                }
                checked={prefs.handsFree}
                onChange={(handsFree) => prefs.set({ handsFree })}
              />
              {prefs.handsFree && (
                <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block text-[15px] font-medium">Pause before you’re done</span>
                    <span className="block text-[13px] text-muted-foreground">How long you stay quiet to finish an answer. Pick Long if you stop to think.</span>
                  </span>
                  <Segmented
                    size="sm"
                    layoutId="interview-patience"
                    value={prefs.patience}
                    onChange={(patience) => prefs.set({ patience })}
                    options={[
                      { value: 'short', label: 'Short' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'long', label: 'Long' },
                    ]}
                  />
                </div>
              )}
              {prefs.mode === 'interview' ? (
                !prefs.handsFree && (
                  <Toggle
                    label="Start recording when the question ends"
                    hint="Answer straight away, the way you would in the room."
                    checked={prefs.autoRecord}
                    onChange={(autoRecord) => prefs.set({ autoRecord })}
                  />
                )
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block text-[15px] font-medium">Thinking time</span>
                    <span className="block text-[13px] text-muted-foreground">A short pause to plan before you answer.</span>
                  </span>
                  <Segmented
                    size="sm"
                    layoutId="interview-think"
                    value={String(prefs.thinkSeconds)}
                    onChange={(value) => prefs.set({ thinkSeconds: Number(value) })}
                    options={[
                      { value: '0', label: 'Off' },
                      { value: '15', label: '15 s' },
                      { value: '30', label: '30 s' },
                    ]}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The footer every setup ends with: what is kept, a mic check, and the start button. */
export function StartBar({ label, pending, onStart, note }: { label: string; pending: boolean; onStart: () => void; note?: ReactNode }) {
  const signedIn = useSettings((s) => !!s.accountEmail)
  const setMicCheckOpen = useUI((s) => s.setMicCheckOpen)
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-7 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
        {note ??
          (signedIn
            ? 'Saved to your account after every answer, as text only. No audio is kept.'
            : 'You can try it now. Sign in to see your feedback and keep your interviews.')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="lg" className="h-12" onClick={() => setMicCheckOpen(true)}>
          <MicrophoneIcon weight="fill" /> Check microphone
        </Button>
        <Button size="lg" className="h-12 px-7 text-[15px]" onClick={onStart} disabled={pending}>
          {pending ? <SpinnerGapIcon className="motion-safe:animate-spin" /> : null}
          {label}
          <ArrowRightIcon
            weight="bold"
            className="transition-transform duration-200 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover/button:translate-x-0.5"
          />
        </Button>
      </div>
    </div>
  )
}
