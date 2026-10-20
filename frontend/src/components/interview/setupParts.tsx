import { ArrowRightIcon, MicrophoneIcon, SpinnerGapIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
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
    text: 'No help and no feedback until the end. The interviewer follows up when an answer is missing something.',
  },
  { id: 'practice', title: 'Practice', text: 'Tips before you answer and feedback after every answer. Retry any question.' },
]

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

/** Experience and length, side by side. */
export function LevelAndLength({ levels, counts, showLevel = true }: { levels: { id: string; label: string }[]; counts: number[]; showLevel?: boolean }) {
  const prefs = useInterviewPrefs()
  return (
    <div className="grid gap-9 md:grid-cols-2">
      {showLevel && (
        <Field title="Your experience">
          <Segmented
            layoutId="interview-level"
            value={prefs.level}
            onChange={(level) => prefs.set({ level })}
            options={levels.map((l) => ({ value: l.id, label: LEVEL_SHORT[l.id] ?? l.label }))}
          />
          <p className="mt-2 text-[13px] text-muted-foreground">{levels.find((l) => l.id === prefs.level)?.label}</p>
        </Field>
      )}
      <Field title="How long?">
        <Segmented
          layoutId="interview-count"
          value={String(prefs.count)}
          onChange={(count) => prefs.set({ count: Number(count) })}
          options={counts.map((n) => ({ value: String(n), label: `${n} questions` }))}
        />
        <p className="mt-2 text-[13px] text-muted-foreground">{MINUTES[prefs.count] ?? ''}</p>
      </Field>
    </div>
  )
}

/** Real interview or practice, and the options that go with each. */
export function StyleAndOptions() {
  const prefs = useInterviewPrefs()
  return (
    <>
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

      <Field title="Options">
        <div className="divide-y divide-border rounded-2xl bg-fill px-4">
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
          {prefs.mode === 'interview' ? (
            <Toggle
              label="Start recording when the question ends"
              hint="Answer straight away, the way you would in the room."
              checked={prefs.autoRecord}
              onChange={(autoRecord) => prefs.set({ autoRecord })}
            />
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
      </Field>
    </>
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
