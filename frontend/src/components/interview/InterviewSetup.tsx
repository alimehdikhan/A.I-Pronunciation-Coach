import {
  AirplaneTiltIcon,
  BriefcaseIcon,
  ChatTeardropTextIcon,
  GraduationCapIcon,
  HandshakeIcon,
  InfoIcon,
  LightningIcon,
  PencilSimpleIcon,
  PhoneIcon,
  WrenchIcon,
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
import { useInterviewPrefs } from '@/store/interview'
import { useSettings } from '@/store/settings'

const TYPE_ICON: Partial<Record<InterviewType, Icon>> = {
  full: BriefcaseIcon,
  hr: HandshakeIcon,
  behavioural: ChatTeardropTextIcon,
  technical: WrenchIcon,
  tough: LightningIcon,
  phone: PhoneIcon,
  university: GraduationCapIcon,
  visa: AirplaneTiltIcon,
}

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

  // Picking a kind with the pointer moves straight on; keyboard users (arrow keys change the choice) press Continue.
  const pick = (t: TypeOption, moveOn: boolean) => {
    prefs.set({ type: t.id })
    if (moveOn) setStep(stepsFor(t)[1])
  }

  return (
    <Panel className="p-5 sm:p-8">
      {current === 'kind' && (
        <StepHeader index={at} total={steps.length} title="What are you preparing for?" hint="Pick the interview you have coming up." />
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
          <>
            <div role="radiogroup" aria-label="Kind of interview" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {types.map((t) => {
                const IconComp = TYPE_ICON[t.id] ?? BriefcaseIcon
                const selected = t.id === type.id
                return (
                  <div key={t.id} onPointerUp={() => pick(t, true)}>
                    <Choice name="interview-type" checked={selected} onChange={() => pick(t, false)} className="block h-full p-3.5 sm:p-4">
                      <IconComp size={24} weight={selected ? 'fill' : 'regular'} className="text-primary" />
                      <span className="mt-2 block text-[15px] leading-tight font-semibold sm:mt-2.5">{t.label}</span>
                      <span className="mt-0.5 hidden text-[13px] leading-snug text-muted-foreground sm:block">{t.description}</span>
                    </Choice>
                  </div>
                )
              })}
            </div>
            <ContinueBar onContinue={() => setStep(steps[1])}>
              Selected: <span className="font-medium text-foreground">{type.label}</span>
              <span className="mt-1 block leading-snug sm:hidden">{type.description}</span>
            </ContinueBar>
          </>
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
