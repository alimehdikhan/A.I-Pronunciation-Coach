import { ArrowCounterClockwiseIcon, CheckCircleIcon, InfoIcon, PlusIcon, ShuffleIcon, SparkleIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { LockedResults } from '@/components/auth/SignInGate'
import { Panel, Pill, Segmented, SectionLabel } from '@/components/common'
import { GD_LENGTHS, GdRoom, type GdLength } from '@/components/gd/GdRoom'
import { ScoreBar } from '@/components/interview/AnswerFeedback'
import { ListenLong } from '@/components/interview/ListenLong'
import { Choice, Field, StartBar } from '@/components/interview/setupParts'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { errorLine } from '@/lib/errors'
import type { GdKey, GdReport, GdTopics, GdTurn } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const GD_LABELS: Record<GdKey, string> = {
  content: 'Content and ideas',
  communication: 'Communication',
  teamwork: 'Teamwork',
  leadership: 'Leadership',
}

const ASSESSORS_LOOK_FOR = [
  'Starting the discussion with a clear view',
  'New points, backed by an example',
  'Listening and building on others: “Adding to Priya’s point …”',
  'Disagreeing politely, and inviting quieter people in',
  'Summarising both sides at the end',
]

function Setup({
  data,
  onStart,
}: {
  data: GdTopics
  onStart: (topic: { id: string; title: string }, length: GdLength) => void
}) {
  const [topicId, setTopicId] = useState(data.topics[0].id)
  const [length, setLength] = useState<GdLength>('short')
  const topic = data.topics.find((t) => t.id === topicId) ?? data.topics[0]
  return (
    <Panel className="p-5 sm:p-8">
      <div className="space-y-9">
        <Field
          title="Choose a topic"
          hint={
            <span className="flex flex-wrap items-center gap-x-2">
              Topics like the ones used in campus placements and job selections.
              <button
                type="button"
                onClick={() => setTopicId(data.topics[Math.floor(Math.random() * data.topics.length)].id)}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <ShuffleIcon weight="bold" /> Surprise me
              </button>
            </span>
          }
        >
          <div role="radiogroup" aria-label="Topic" className="grid gap-2.5 sm:grid-cols-2">
            {data.topics.map((t) => (
              <Choice key={t.id} name="gd-topic" checked={t.id === topicId} onChange={() => setTopicId(t.id)} className="px-4 py-3.5">
                <span className="text-[15px] font-medium">{t.title}</span>
              </Choice>
            ))}
          </div>
        </Field>

        <Field title="How long?">
          <Segmented
            layoutId="gd-length"
            value={length}
            onChange={setLength}
            options={(Object.keys(GD_LENGTHS) as GdLength[]).map((key) => ({ value: key, label: GD_LENGTHS[key].label }))}
          />
        </Field>

        <div className="rounded-2xl bg-fill p-5">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <UsersThreeIcon size={20} weight="fill" className="text-primary" /> Who you’ll be talking with
          </div>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
            {data.personas.map((p) => p.name).join(', ')}, each with their own view and voice. Alex moderates. Jump in whenever you
            want, even mid-sentence, the way a real discussion works.
          </p>
          <div className="mt-4 text-[13px] font-semibold text-muted-foreground">What assessors look for</div>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ASSESSORS_LOOK_FOR.map((item) => (
              <li key={item} className="flex gap-2 text-[14px] leading-snug">
                <CheckCircleIcon size={17} weight="fill" className="mt-px shrink-0 text-good" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <StartBar
          label="Start the discussion"
          pending={false}
          onStart={() => onStart(topic, length)}
          note="Nothing is saved: your contributions are transcribed for this discussion only."
        />
      </div>
    </Panel>
  )
}

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <div className="rounded-2xl bg-fill p-4">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-[26px] leading-none font-semibold tabular-nums">{value}</div>
      <div className="mt-1.5 text-[12px] leading-snug text-subtle">{hint}</div>
    </div>
  )
}

function Report({ report, turns, onAgain, onNew }: { report: GdReport; turns: GdTurn[]; onAgain: () => void; onNew: () => void }) {
  const signedIn = useSettings((s) => !!s.accountEmail)
  const { stats, checks, rubric } = report
  const passed = checks.filter((c) => c.ok).length
  return (
    <div className="space-y-5">
      <Panel className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="headline text-[28px] tracking-[-0.02em] sm:text-[34px]">Discussion report</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">{report.topic.title}</p>
          </div>
          <Pill tone={rubric ? 'primary' : 'neutral'}>{rubric ? <><SparkleIcon weight="fill" /> AI assessment</> : 'Quick checks'}</Pill>
        </div>

        {!signedIn ? (
          <div className="mt-6">
            <LockedResults />
          </div>
        ) : (
          <>
            <p className="mt-6 max-w-3xl text-[17px] leading-relaxed font-medium">
              {rubric?.summary ?? `${passed} of ${checks.length} things assessors look for. The fixes below make the biggest difference.`}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Figure label="You spoke" value={stats.contributions} hint={`time${stats.contributions === 1 ? '' : 's'}; 3 to 5 is good`} />
              <Figure label="Share of time" value={`${Math.round(stats.share * 100)}%`} hint="about a quarter is fair in a group of four" />
              <Figure label="Pace" value={stats.average_wpm ?? '—'} hint="words a minute; 120–160 is easy to follow" />
              <Figure label="Fillers" value={stats.fillers_per_minute ?? '—'} hint="“um”s and “uh”s a minute, approximate" />
            </div>

            {rubric && (
              <div className="mt-8 space-y-2.5">
                {(Object.keys(GD_LABELS) as GdKey[]).map((key) => (
                  <ScoreBar key={key} label={GD_LABELS[key]} value={rubric.scores[key]} />
                ))}
              </div>
            )}

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div>
                <SectionLabel className="mb-2.5">Work on</SectionLabel>
                <ul className="space-y-2.5">
                  {[...(rubric?.improvements ?? []), ...checks.filter((c) => !c.ok).map((c) => c.fix!)].slice(0, 5).map((tip) => (
                    <li key={tip} className="flex gap-2.5 text-[15px] leading-snug">
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <SectionLabel className="mb-2.5">Went well</SectionLabel>
                <ul className="space-y-2.5">
                  {[...(rubric?.strengths ?? []), ...checks.filter((c) => c.ok).map((c) => c.label)].slice(0, 5).map((item) => (
                    <li key={item} className="flex gap-2.5 text-[15px] leading-snug">
                      <CheckCircleIcon size={18} weight="fill" className="mt-px shrink-0 text-good" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {rubric?.better_point && (
              <div className="mt-8 rounded-2xl border border-primary/20 bg-primary-soft/60 p-4 sm:p-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-primary">
                    <SparkleIcon weight="fill" /> One of your points, made stronger
                  </div>
                  <ListenLong text={rubric.better_point} speakKey="gd-better" />
                </div>
                <p className="text-[16px] leading-relaxed">{rubric.better_point}</p>
                <p className="mt-2 text-[12px] text-muted-foreground">Your idea, said more clearly. Nothing new is added.</p>
              </div>
            )}
          </>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <Button size="lg" className="h-12 px-6" onClick={onAgain}>
            <ArrowCounterClockwiseIcon weight="bold" /> Same topic again
          </Button>
          <Button size="lg" variant="secondary" className="h-12" onClick={onNew}>
            <PlusIcon weight="bold" /> Another topic
          </Button>
        </div>
      </Panel>

      {signedIn && (
        <Panel className="p-5 sm:p-7">
          <details>
            <summary className="cursor-pointer text-[15px] font-semibold select-none">Transcript</summary>
            <ol className="mt-3 space-y-2">
              {turns.map((t, i) => (
                <li key={i} className={cn('rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed', t.you ? 'bg-primary-soft' : 'bg-fill')}>
                  <span className="font-semibold">{t.you ? 'You' : t.speaker}: </span>
                  {t.text}
                </li>
              ))}
            </ol>
          </details>
        </Panel>
      )}
    </div>
  )
}

type Stage =
  | { name: 'setup' }
  | { name: 'live'; topic: { id: string; title: string }; length: GdLength; run: number }
  | { name: 'report'; topic: { id: string; title: string }; length: GdLength; turns: GdTurn[] }

/** Group discussion practice: pick a topic, discuss it with three AI participants, read the assessor's report. */
export function GroupDiscussion({ header }: { header: { title: string; description: string; actions: ReactNode } }) {
  const username = useSettings((s) => s.username)
  const displayName = useSettings((s) => s.displayName)
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['gd-topics'], queryFn: api.gdTopics, staleTime: Infinity })
  const [stage, setStage] = useState<Stage>({ name: 'setup' })
  const report = useMutation({ mutationFn: api.gdReport })

  const finish = (topic: { id: string; title: string }, length: GdLength, turns: GdTurn[]) => {
    setStage({ name: 'report', topic, length, turns })
    window.scrollTo({ top: 0 })
    report.mutate({ topic_id: topic.id, user_name: (displayName || username).split(' ')[0] ?? '', turns })
  }

  if (stage.name === 'live' && data) {
    return (
      <GdRoom
        key={stage.run}
        topic={stage.topic}
        personas={data.personas}
        length={stage.length}
        onDone={(turns) => finish(stage.topic, stage.length, turns)}
        onExit={() => setStage({ name: 'setup' })}
      />
    )
  }

  return (
    <>
      <PageHeader eyebrow="Interview prep" title={header.title} description={header.description} actions={header.actions} />
      {stage.name === 'report' ? (
        report.isPending ? (
          <Skeleton className="h-96 w-full rounded-[30px]" />
        ) : report.isError ? (
          <Panel className="p-8 text-center">
            <p className="flex items-center justify-center gap-2 text-[15px] text-muted-foreground">
              <InfoIcon weight="fill" /> {errorLine(report.error)}
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => setStage({ name: 'setup' })}>
              Back to topics
            </Button>
          </Panel>
        ) : report.data ? (
          <Report
            report={report.data}
            turns={stage.turns}
            onAgain={() => setStage({ name: 'live', topic: stage.topic, length: stage.length, run: Date.now() })}
            onNew={() => setStage({ name: 'setup' })}
          />
        ) : null
      ) : isLoading ? (
        <Skeleton className="h-[560px] w-full rounded-[30px]" />
      ) : isError || !data ? (
        <Panel className="p-8 text-center">
          <p className="text-[15px] text-muted-foreground">Couldn’t load the topics.</p>
          <Button variant="secondary" className="mt-4" onClick={() => void refetch()}>
            Try again
          </Button>
        </Panel>
      ) : (
        <Setup data={data} onStart={(topic, length) => setStage({ name: 'live', topic, length, run: Date.now() })} />
      )}
    </>
  )
}
