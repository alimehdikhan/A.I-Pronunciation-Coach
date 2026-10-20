import { ArrowCircleUpRightIcon, ArrowCounterClockwiseIcon, CaretDownIcon, PlusIcon, SparkleIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { LockedResults } from '@/components/auth/SignInGate'
import { Panel, Pill, SectionLabel } from '@/components/common'
import { AnswerFeedback, CONTENT_LABELS, ScoreBar, verdict, viewFromStored } from '@/components/interview/AnswerFeedback'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useSoundName } from '@/lib/soundNames'
import type { ContentKey, InterviewDetail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

function Figure({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-2xl bg-fill p-4">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-[28px] leading-none font-semibold tabular-nums', tone === 'good' && 'text-good', tone === 'warn' && 'text-warn')}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] leading-snug text-subtle">{hint}</div>
    </div>
  )
}

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/** The whole interview at a glance, then every answer's feedback. */
export function InterviewReport({
  detail,
  onAgain,
  onNew,
  onResume,
  onDelete,
  deleting,
}: {
  detail: InterviewDetail
  onAgain: () => void
  onNew: () => void
  onResume?: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const signedIn = useSettings((s) => !!s.accountEmail)
  const soundName = useSoundName()
  const openPhoneme = useUI((s) => s.openPhoneme)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { report } = detail
  const subtitle = [detail.type_label, detail.role_label, detail.level_label].filter(Boolean).join(' · ')

  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      {onResume && !detail.finished && (
        <Button size="lg" className="h-12 px-6" onClick={onResume}>
          Carry on: {detail.total - detail.answered} question{detail.total - detail.answered === 1 ? '' : 's'} left
        </Button>
      )}
      <Button size="lg" variant={onResume && !detail.finished ? 'secondary' : 'default'} className="h-12 px-6" onClick={onAgain}>
        <ArrowCounterClockwiseIcon weight="bold" /> Practise again
      </Button>
      <Button size="lg" variant="secondary" className="h-12" onClick={onNew}>
        <PlusIcon weight="bold" /> New interview
      </Button>
      <Button size="lg" variant="ghost" className="h-12 text-bad hover:text-bad" onClick={() => setConfirmDelete(true)} disabled={deleting}>
        <TrashIcon weight="bold" /> Delete
      </Button>
    </div>
  )

  return (
    <div className="space-y-5">
      <Panel className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="headline text-[28px] tracking-[-0.02em] sm:text-[34px]">{detail.finished ? 'Interview report' : 'Interview so far'}</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {subtitle} · {dateLabel(detail.created_at)}
            </p>
          </div>
          <Pill tone={detail.finished ? 'good' : 'warn'}>
            {detail.answered} of {detail.total} answered
          </Pill>
        </div>

        {!signedIn ? (
          <div className="mt-6">
            <LockedResults />
          </div>
        ) : report.answered === 0 ? (
          <p className="mt-6 text-[15px] text-muted-foreground">No answers yet. Carry on with the interview to get your report.</p>
        ) : (
          <>
            <div className="mt-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Figure
                label="Content"
                value={report.content_overall != null ? <>{report.content_overall}<span className="text-[15px] text-subtle">/5</span></> : '—'}
                hint={report.content_overall != null ? 'AI feedback on what you said' : 'needs the AI coach to be switched on'}
                tone={report.content_overall != null ? (report.content_overall >= 3.5 ? 'good' : report.content_overall < 2.5 ? 'warn' : undefined) : undefined}
              />
              <Figure label="Checks passed" value={`${report.checks_passed}/${report.checks_total}`} hint="length, examples, results, pace and fillers" />
              <Figure label="Average pace" value={report.average_wpm ?? '—'} hint="words a minute; 120–160 is easy to follow" />
              <Figure
                label="Fillers"
                value={report.fillers_per_minute ?? '—'}
                hint="“um”s and “uh”s a minute, approximate"
                tone={report.fillers_per_minute != null && report.fillers_per_minute > 6 ? 'warn' : undefined}
              />
            </div>

            {report.focus.length > 0 && (
              <div className="mt-8">
                <SectionLabel icon={<ArrowCircleUpRightIcon weight="fill" />}>Work on these next</SectionLabel>
                <ul className="space-y-3">
                  {report.focus.map((tip) => (
                    <li key={tip} className="flex gap-3 text-[16px] leading-snug">
                      <span className="mt-[8px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.content && (
              <div className="mt-8 space-y-2.5">
                <SectionLabel icon={<SparkleIcon weight="fill" />}>What you said, on average</SectionLabel>
                {(Object.keys(CONTENT_LABELS) as ContentKey[]).map((key) => (
                  <ScoreBar key={key} label={CONTENT_LABELS[key]} value={report.content![key]} />
                ))}
              </div>
            )}

            {report.sounds.length > 0 && (
              <div className="mt-8">
                <SectionLabel>Sounds to practise</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {report.sounds.map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => openPhoneme(symbol)}
                      className="rounded-full bg-fill px-3.5 py-1.5 text-[14px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-fill-strong active:scale-[0.97]"
                    >
                      {soundName(symbol).text}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-8 border-t border-border pt-6">{actions}</div>
      </Panel>

      {signedIn &&
        detail.questions.map((question) => {
          const stored = detail.answers[String(question.index)]
          return (
            <Panel key={question.index} className="overflow-hidden">
              <details className="group" open={detail.questions.length <= 3 && !!stored}>
                <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-5 select-none sm:px-7 [&::-webkit-details-marker]:hidden">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-fill text-[13px] font-semibold tabular-nums">
                    {(question.index ?? 0) + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] leading-snug font-semibold">{question.text}</span>
                    <span className="mt-1 block text-[14px] text-muted-foreground">
                      {stored ? verdict(viewFromStored(question, stored)) : 'Not answered'}
                    </span>
                  </span>
                  <CaretDownIcon className="mt-1.5 size-4 shrink-0 text-subtle transition-transform duration-200 group-open:rotate-180" />
                </summary>
                {stored && (
                  <div className="border-t border-border px-5 py-6 sm:px-7">
                    <AnswerFeedback view={viewFromStored(question, stored)} />
                  </div>
                )}
              </details>
            </Panel>
          )
        })}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this interview?</AlertDialogTitle>
            <AlertDialogDescription>Its answers and feedback are removed for good. Your other progress stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-bad text-white hover:bg-bad/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
