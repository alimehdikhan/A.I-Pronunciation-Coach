import {
  AirplaneTakeoffIcon,
  BriefcaseIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  FireIcon,
  GraduationCapIcon,
  IdentificationCardIcon,
  InfoIcon,
  PencilSimpleIcon,
  PhoneCallIcon,
  ToolboxIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Panel } from '@/components/common'
import {
  Choice,
  ContinueBar,
  Field,
  LEVEL_SHORT,
  LengthChoice,
  LevelChoice,
  ModeChoice,
  MoreOptions,
  StartBar,
  StepBody,
  StepHeader,
} from '@/components/interview/setupParts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { showError } from '@/lib/errors'
import type { InterviewStart, InterviewType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useInterviewPrefs } from '@/store/interview'
import { useSettings } from '@/store/settings'

/** Each kind of interview: an app-style icon (a white symbol on its own colour) and one short line. */
const KIND: Partial<Record<InterviewType, { icon: Icon; tile: string; line: string }>> = {
  full: { icon: BriefcaseIcon, tile: 'from-[#4fa3ff] to-[#0a6cff]', line: 'The complete interview, start to finish' },
  hr: { icon: IdentificationCardIcon, tile: 'from-[#5fe08a] to-[#22a95a]', line: 'Background, motivation and salary' },
  behavioural: { icon: ChatsCircleIcon, tile: 'from-[#ffb340] to-[#ff8a00]', line: 'Real stories, told step by step' },
  technical: { icon: ToolboxIcon, tile: 'from-[#b18cff] to-[#7a4dff]', line: 'How you do the work in your field' },
  tough: { icon: FireIcon, tile: 'from-[#ff7a85] to-[#ff2d55]', line: 'Gaps, layoffs and hard questions' },
  phone: { icon: PhoneCallIcon, tile: 'from-[#4fe0d0] to-[#13a89e]', line: 'A short first call with a recruiter' },
  university: { icon: GraduationCapIcon, tile: 'from-[#8c8dff] to-[#5856d6]', line: 'Why this programme, and your goals' },
  visa: { icon: AirplaneTakeoffIcon, tile: 'from-[#5ac8fa] to-[#1e8ee0]', line: 'Study plans, funding and what comes next' },
}
const STUDY: InterviewType[] = ['university', 'visa']

type Step = 'kind' | 'about' | 'how'
type TypeOption = { id: InterviewType; label: string; description: string; role: boolean; level: boolean }

/** The steps a kind of interview needs: "about the job" only when the role or experience shape the questions. */
function stepsFor(type: TypeOption): Step[] {
  return type.role || type.level ? ['kind', 'about', 'how'] : ['kind', 'how']
}

/**
 * Setting up a mock interview, one short step at a time: what it is for, a little about the job, and
 * how it should go. The choices are remembered, so the next interview can start from the last step.
 */
export function InterviewSetup({ onStart }: { onStart: (session: InterviewStart) => void }) {
  const prefs = useInterviewPrefs()
  const username = useSettings((s) => s.username)
  const [step, setStep] = useState<Step>('kind')
  const { data: options, isLoading, isError, refetch } = useQuery({
    queryKey: ['interview-options'],
    queryFn: api.interviewOptions,
    staleTime: Infinity,
  })
  const start = useMutation({ mutationFn: api.interviewStart, onSuccess: onStart, onError: showError })

  if (isLoading) return <Skeleton className="h-[520px] w-full rounded-[30px]" />
  if (isError || !options) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-[15px] text-muted-foreground">Couldn’t load the interview options.</p>
        <Button variant="secondary" className="mt-4" onClick={() => void refetch()}>
          Try again
        </Button>
      </Panel>
    )
  }

  const types = options.types as TypeOption[]
  const type = types.find((t) => t.id === prefs.type) ?? types[0]
  const steps = stepsFor(type)
  const at = Math.max(0, steps.indexOf(step))
  const current = steps[at]
  const back = at > 0 ? () => setStep(steps[at - 1]) : undefined
  const roleLabel = options.roles.find((r) => r.id === prefs.role)?.label
  // A visa or admission interview isn't for a company's job.
  const forJob = type.id !== 'visa' && type.id !== 'university'
  const begin = () =>
    start.mutate({
      type: type.id,
      role: prefs.role,
      level: prefs.level,
      count: prefs.count,
      username: username || undefined,
      company: forJob ? prefs.company.trim() || undefined : undefined,
      job_title: forJob ? prefs.jobTitle.trim() || undefined : undefined,
    })

  // Picking a kind moves straight on: one tap, no separate Continue.
  const pick = (t: TypeOption) => {
    prefs.set({ type: t.id })
    setStep(stepsFor(t)[1])
  }
  const groups = [
    { title: 'Job interviews', items: types.filter((t) => !STUDY.includes(t.id)) },
    { title: 'Study abroad', items: types.filter((t) => STUDY.includes(t.id)) },
  ].filter((g) => g.items.length > 0)

  return (
    <Panel className="p-5 sm:p-8">
      {current === 'kind' && (
        <StepHeader index={at} total={steps.length} title="What are you preparing for?" />
      )}
      {current === 'about' && (
        <StepHeader
          index={at}
          total={steps.length}
          title={type.role ? 'Tell us about the job' : 'Your experience'}
          hint="The questions are chosen to fit."
          onBack={back}
        />
      )}
      {current === 'how' && (
        <StepHeader
          index={at}
          total={steps.length}
          title="How should it go?"
          onBack={back}
          hint={
            // What was chosen, with a quick way back to change it.
            <span className="flex flex-wrap items-center gap-x-1.5">
              <span className="font-medium text-foreground">{type.label}</span>
              {forJob && prefs.jobTitle.trim() ? (
                <span>
                  · {prefs.jobTitle.trim()}
                  {prefs.company.trim() ? ` at ${prefs.company.trim()}` : ''}
                </span>
              ) : (
                type.role && roleLabel && <span>· {roleLabel}</span>
              )}
              {type.level && <span>· {LEVEL_SHORT[prefs.level] ?? prefs.level}</span>}
              <button
                type="button"
                onClick={() => setStep('kind')}
                className="ml-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <PencilSimpleIcon weight="bold" /> Change
              </button>
            </span>
          }
        />
      )}

      <StepBody step={current}>
        {current === 'kind' && (
          <div className="space-y-7">
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mb-2.5 text-[13px] font-semibold text-muted-foreground">{group.title}</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((t) => {
                    const kind = KIND[t.id]
                    const IconComp = kind?.icon ?? BriefcaseIcon
                    const last = t.id === type.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => pick(t)}
                        className={cn(
                          'group flex items-center gap-3.5 rounded-2xl bg-fill p-3 text-left outline-none',
                          'transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-fill-strong active:scale-[0.98]',
                          'focus-visible:ring-2 focus-visible:ring-primary',
                          last && 'shadow-[inset_0_0_0_1.5px_var(--primary)]',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'grid size-11 shrink-0 place-items-center rounded-[13px] bg-gradient-to-b text-white',
                            'shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_10px_-4px_rgb(0_0_0/0.35)]',
                            kind?.tile ?? 'from-[#4fa3ff] to-[#0a6cff]',
                          )}
                        >
                          <IconComp size={22} weight="fill" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[15px] leading-tight font-semibold">{t.label}</span>
                            {t.id === 'full' && (
                              <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                                Recommended
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{kind?.line ?? t.description}</span>
                        </span>
                        {last && <span className="sr-only">(your last choice)</span>}
                        <CaretRightIcon
                          aria-hidden
                          weight="bold"
                          className="shrink-0 text-subtle transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                        />
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {current === 'about' && (
          <div className="space-y-9">
            {type.role && (
              <Field title="Which field?">
                <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-2">
                  {options.roles.map((role) => (
                    <Choice
                      key={role.id}
                      name="interview-role"
                      checked={role.id === prefs.role}
                      onChange={() => prefs.set({ role: role.id })}
                      className="rounded-full border-[1.5px] px-4 py-2 text-[14px] font-medium"
                    >
                      {role.label}
                    </Choice>
                  ))}
                </div>
              </Field>
            )}
            {type.level && <LevelChoice levels={options.levels} />}
            {forJob && (
              <Field title="The job you're preparing for" hint="Optional. The interviewer asks about this job, the way someone hiring for it would.">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Input
                    value={prefs.jobTitle}
                    onChange={(e) => prefs.set({ jobTitle: e.target.value })}
                    placeholder="Job title, e.g. Backend Developer"
                    aria-label="Job title"
                    maxLength={60}
                    className="h-11 rounded-xl text-[15px]"
                  />
                  <Input
                    value={prefs.company}
                    onChange={(e) => prefs.set({ company: e.target.value })}
                    placeholder="Company, e.g. Infosys"
                    aria-label="Company"
                    maxLength={60}
                    className="h-11 rounded-xl text-[15px]"
                  />
                </div>
              </Field>
            )}
            <ContinueBar onContinue={() => setStep('how')} />
          </div>
        )}

        {current === 'how' && (
          <div className="space-y-7">
            {type.id === 'visa' && (
              <p className="flex gap-2 rounded-2xl bg-fill px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
                <InfoIcon size={18} weight="fill" className="mt-px shrink-0 text-primary" />
                Practice for answering clearly and confidently. It isn’t immigration advice: always answer an officer truthfully.
              </p>
            )}
            <ModeChoice />
            <LengthChoice counts={options.counts} />
            <MoreOptions />
            <StartBar label="Start interview" pending={start.isPending} onStart={begin} />
          </div>
        )}
      </StepBody>
    </Panel>
  )
}
