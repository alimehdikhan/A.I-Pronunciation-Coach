import { ChatTextIcon, ClockCountdownIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { Pill, SectionLabel } from '@/components/common'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import { STATUS_META, cn, scoreTone, toneText } from '@/lib/utils'

/**
 * What a teacher sees through a share link: the attempt read-only (audio, transcript, analysis)
 * and a comment box. No account and no learner name.
 */
export default function SharedPage() {
  const { token = '' } = useParams()
  const queryClient = useQueryClient()
  const { data, error, isLoading } = useQuery({ queryKey: ['shared', token], queryFn: () => api.sharedView(token), retry: false })
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const comment = useMutation({
    mutationFn: () => api.sharedComment(token, { author: author.trim() || null, text: text.trim() }),
    meta: { silent: true },
    onSuccess: () => {
      setText('')
      void queryClient.invalidateQueries({ queryKey: ['shared', token] })
    },
  })

  const gone = error instanceof ApiError && (error.status === 410 || error.status === 404)
  const a = data?.attempt

  return (
    <div className="min-h-dvh bg-background px-4 py-10">
      <main className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <div>
            <div className="text-[13px] font-semibold text-muted-foreground">Vocaly AI</div>
            <h1 className="text-[22px] font-semibold tracking-tight">A practice attempt shared with you</h1>
          </div>
        </div>

        {isLoading && <Skeleton className="h-64 w-full rounded-[30px]" />}
        {gone && (
          <section className="surface p-6 text-[15px]">
            <b>This link has expired.</b> Shared attempts are available for 7 days, and the learner can stop sharing earlier.
          </section>
        )}
        {error && !gone && <section className="surface p-6 text-[15px]">Could not load this attempt. Try again later.</section>}

        {a && data && (
          <>
            <section className="surface space-y-5 p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-muted-foreground">Target sentence</div>
                  <p className="text-[20px] font-semibold">{a.reference_text}</p>
                </div>
                <span className={cn('headline text-[44px] tabular-nums', toneText[scoreTone(a.score)])}>{Math.round(a.score)}</span>
              </div>
              {data.has_audio ? (
                <audio controls preload="none" src={api.sharedAudioUrl(token)} className="w-full" aria-label="The learner's recording" />
              ) : (
                <p className="text-[14px] text-subtle">The recording is no longer available.</p>
              )}
              <div>
                <div className="mb-2 text-[13px] font-semibold text-muted-foreground">Word by word</div>
                <p className="flex flex-wrap gap-x-1.5 gap-y-1 text-[20px] font-semibold">
                  {a.words.map((w, i) => (
                    <span
                      key={i}
                      className={cn('rounded-md px-1', STATUS_META[w.status]?.text, w.status === 'mispronounced' && (w.tier === 'check' ? 'bg-warn-soft text-warn' : 'bg-bad-soft'))}
                      title={STATUS_META[w.status]?.label}
                    >
                      {w.display}
                    </span>
                  ))}
                </p>
                <p className="mt-2 text-[14px] text-muted-foreground">Heard: “{a.transcription}”</p>
              </div>
              {!!a.insights.length && (
                <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted-foreground">
                  {a.insights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 text-[13px]">
                {Object.entries(a.metrics).map(([k, v]) => (
                  <Pill key={k} tone="neutral" className="capitalize">
                    {k} {v == null ? '—' : Math.round(v)}
                  </Pill>
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[12px] text-subtle">
                <ClockCountdownIcon size={14} /> Link works until{' '}
                {new Date(data.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Scores
                are a machine estimate.
              </p>
            </section>

            <section className="surface space-y-4 p-6 sm:p-8">
              <SectionLabel icon={<ChatTextIcon weight="fill" />}>Comments for the learner</SectionLabel>
              {data.comments.map((c, i) => (
                <div key={i} className="rounded-2xl bg-fill p-3 text-[15px]">
                  <div className="text-[12px] font-semibold text-muted-foreground">{c.author || 'Teacher'}</div>
                  {c.text}
                </div>
              ))}
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (text.trim()) comment.mutate()
                }}
              >
                <Input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={40} placeholder="Your name (optional)" aria-label="Your name" />
                <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={4} placeholder="What should they work on?" aria-label="Comment" />
                {comment.error && <p className="text-[13px] text-bad">{comment.error instanceof Error ? comment.error.message : 'Could not send.'}</p>}
                <Button type="submit" disabled={!text.trim() || comment.isPending}>
                  <PaperPlaneRightIcon weight="fill" /> Send comment
                </Button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
