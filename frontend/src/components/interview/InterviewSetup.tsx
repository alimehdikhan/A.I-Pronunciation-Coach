import {
  AirplaneTiltIcon,
  BriefcaseIcon,
  ChatTeardropTextIcon,
  GraduationCapIcon,
  HandshakeIcon,
  InfoIcon,
  LightningIcon,
  PhoneIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Panel } from '@/components/common'
import { Choice, Field, LevelAndLength, StartBar, StyleAndOptions } from '@/components/interview/setupParts'
import { Button } from '@/components/ui/button'
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

/** Choose the kind of interview, the role and experience, its length and how it should feel. */
export function InterviewSetup({ onStart }: { onStart: (session: InterviewStart) => void }) {
  const prefs = useInterviewPrefs()
  const username = useSettings((s) => s.username)
  const { data: options, isLoading, isError, refetch } = useQuery({
    queryKey: ['interview-options'],
    queryFn: api.interviewOptions,
    staleTime: Infinity,
  })
  const start = useMutation({ mutationFn: api.interviewStart, onSuccess: onStart, onError: showError })

  if (isLoading) return <Skeleton className="h-[640px] w-full rounded-[30px]" />
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

  const type = options.types.find((t) => t.id === prefs.type) ?? options.types[0]
  const begin = () =>
    start.mutate({ type: type.id, role: prefs.role, level: prefs.level, count: prefs.count, username: username || undefined })

  return (
    <Panel className="p-5 sm:p-8">
      <div className="space-y-9">
        <Field title="What kind of interview?">
          <div role="radiogroup" aria-label="Kind of interview" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {options.types.map((t) => {
              const IconComp = TYPE_ICON[t.id] ?? BriefcaseIcon
              return (
                <Choice key={t.id} name="interview-type" checked={t.id === type.id} onChange={() => prefs.set({ type: t.id })} className="p-4">
                  <IconComp size={24} weight={t.id === type.id ? 'fill' : 'regular'} className="text-primary" />
                  <span className="mt-2.5 block text-[15px] font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{t.description}</span>
                </Choice>
              )
            })}
          </div>
          {type.id === 'visa' && (
            <p className="mt-3 flex gap-2 rounded-2xl bg-fill px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              <InfoIcon size={18} weight="fill" className="mt-px shrink-0 text-primary" />
              Practice for answering clearly and confidently. It isn’t immigration advice: always answer an officer truthfully.
            </p>
          )}
        </Field>

        {type.role && (
          <Field title="Which role?" hint="Questions about your field come from this.">
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

        <LevelAndLength levels={options.levels} counts={options.counts} showLevel={type.level} />
        <StyleAndOptions />
        <StartBar label="Start interview" pending={start.isPending} onStart={begin} />
      </div>
    </Panel>
  )
}
