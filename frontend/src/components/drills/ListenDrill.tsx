import { ArrowClockwiseIcon, ArrowRightIcon, CheckCircleIcon, EarIcon, SpeakerHighIcon, XCircleIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pill, SectionLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useHotkeys } from '@/hooks/useHotkeys'
import { api } from '@/lib/api'
import { audioEngine } from '@/lib/audioEngine'
import { keys, useVoiceCatalog } from '@/lib/queries'
import { useSoundName } from '@/lib/soundNames'
import type { ListenTrial, PerceptionStat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

interface Answer {
  trial: ListenTrial
  chosen: 0 | 1
}

/** The two sounds of a contrast in plain letters: "th vs s". */
function useContrastName() {
  const soundName = useSoundName()
  return (phoneme: string, other: string) => `${soundName(phoneme).spelled} vs ${soundName(other).spelled}`
}

function Summary({ stats, onAgain }: { stats: PerceptionStat[]; onAgain: () => void }) {
  const contrastName = useContrastName()
  const total = stats.reduce((n, s) => n + s.trials, 0)
  const right = stats.reduce((n, s) => n + s.correct, 0)
  return (
    <div className="space-y-4" role="status">
      <div className="text-[17px] font-semibold">
        You heard {right} of {total} right ({total ? Math.round((100 * right) / total) : 0}%).
      </div>
      <ul className="space-y-2">
        {stats.map((s) => (
          <li key={s.phoneme + s.other} className="flex items-center justify-between rounded-xl bg-fill px-4 py-2.5 text-[15px]">
            <span className="font-medium">{contrastName(s.phoneme, s.other)}</span>
            <Pill tone={s.accuracy >= 0.8 ? 'good' : s.accuracy >= 0.6 ? 'warn' : 'bad'}>
              {s.correct}/{s.trials}
            </Pill>
          </li>
        ))}
      </ul>
      <p className="text-[14px] text-muted-foreground">
        Hearing a difference comes before saying it. Short sessions on several days help more than one long one.
      </p>
      <Button onClick={onAgain}>
        <ArrowClockwiseIcon weight="bold" /> Another session
      </Button>
    </div>
  )
}

/**
 * "Which word did you hear?": one word of a minimal pair per trial, each in a different voice,
 * with feedback after every answer. Results are stored as perception, separately from speaking.
 */
export function ListenDrill({ focus, trials = 20, onFinish }: { focus?: string | null; trials?: number; onFinish?: () => void }) {
  const username = useSettings((s) => s.username)
  const queryClient = useQueryClient()
  const contrastName = useContrastName()
  const { data: catalog } = useVoiceCatalog()
  const [round, setRound] = useState(0)
  const { data: session, isLoading, isError } = useQuery({
    queryKey: ['listen-session', username, focus ?? null, trials, round],
    queryFn: () => api.listenSession(username, { focus, trials }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const save = useMutation({
    mutationFn: (done: Answer[]) =>
      api.listenResults(
        username,
        done.map(({ trial, chosen }) => ({
          phoneme: trial.phoneme,
          other: trial.other,
          word: trial.word,
          chosen: trial.words[chosen],
          voice: trial.voice,
        })),
      ),
    onSuccess: () => {
      if (username) void queryClient.invalidateQueries({ queryKey: keys.analytics(username) })
      onFinish?.()
    },
  })

  const list = useMemo(() => session?.trials ?? [], [session])
  const trial = list[index]
  const answered = answers.find((a) => a.trial.index === trial?.index)

  const play = useCallback((word: string, voice: string) => {
    void audioEngine.speak(word, { key: 'listen-drill', voice }).catch(() => undefined)
  }, [])

  // Play each new trial once, and fetch the next two so they start at once.
  useEffect(() => {
    if (!trial) return
    play(trial.word, trial.voice)
    for (const next of list.slice(index + 1, index + 3)) void audioEngine.prefetch(next.word, 1, next.voice).catch(() => undefined)
  }, [trial, index, list, play])

  useEffect(() => () => audioEngine.stop(), [])

  const choose = (chosen: 0 | 1) => {
    if (!trial || answered) return
    setAnswers((prev) => [...prev, { trial, chosen }])
  }
  const next = () => {
    if (!answered) return
    if (index + 1 < list.length) setIndex(index + 1)
    else if (!save.isPending && !save.isSuccess) save.mutate(answers)
  }
  const again = () => {
    setIndex(0)
    setAnswers([])
    save.reset()
    setRound((r) => r + 1)
  }

  useHotkeys(
    {
      '1': () => choose(0),
      arrowleft: () => choose(0),
      '2': () => choose(1),
      arrowright: () => choose(1),
      ' ': () => trial && play(trial.word, trial.voice),
      r: () => trial && play(trial.word, trial.voice),
      enter: next,
    },
    !!trial && !save.isSuccess,
  )

  const voiceName = (id: string) => {
    const v = catalog?.voices.find((x) => x.id === id)
    return v ? `${v.name}, ${v.accent}` : id
  }

  if (isLoading) return <Skeleton className="h-72 w-full rounded-[30px]" />
  if (isError || !session) return <p className="text-[15px] text-muted-foreground">Could not start a listening session. Try again in a moment.</p>
  if (!list.length) return <p className="text-[15px] text-muted-foreground">{session.note ?? 'No listening pairs for this sound yet.'}</p>

  const right = answers.filter((a) => a.chosen === a.trial.answer).length

  return (
    <div>
      <SectionLabel
        icon={<EarIcon weight="fill" />}
        action={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {Math.min(index + 1, list.length)} of {list.length} · {right} right
          </span>
        }
      >
        Which word did you hear?
      </SectionLabel>
      {session.note && <p className="mb-4 rounded-xl bg-warn-soft px-3 py-2 text-[13px]">{session.note}</p>}

      {save.isSuccess ? (
        <Summary stats={save.data.session} onAgain={again} />
      ) : (
        trial && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[14px] text-muted-foreground">
                {contrastName(trial.phoneme, trial.other)} · voice: <span className="font-medium text-foreground">{voiceName(trial.voice)}</span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => play(trial.word, trial.voice)}>
                <SpeakerHighIcon weight="fill" /> Play again <Kbd className="ml-1 hidden sm:inline-flex">Space</Kbd>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Which word did you hear?">
              {trial.words.map((word, i) => {
                const picked = answered?.chosen === i
                const isAnswer = trial.answer === i
                return (
                  <button
                    key={word}
                    type="button"
                    onClick={() => choose(i as 0 | 1)}
                    disabled={!!answered}
                    aria-pressed={picked}
                    className={cn(
                      'flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 py-4 text-[26px] font-semibold transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
                      !answered && 'border-border bg-card hover:bg-fill',
                      answered && isAnswer && 'border-good bg-good-soft text-good',
                      answered && picked && !isAnswer && 'border-bad bg-bad-soft text-bad',
                      answered && !picked && !isAnswer && 'border-border opacity-50',
                    )}
                  >
                    {word}
                    <Kbd className="hidden sm:inline-flex">{i + 1}</Kbd>
                  </button>
                )
              })}
            </div>

            {answered && (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-2xl p-4 text-[15px]',
                  answered.chosen === trial.answer ? 'bg-good-soft' : 'bg-bad-soft',
                )}
                role="status"
              >
                {answered.chosen === trial.answer ? (
                  <CheckCircleIcon size={22} weight="fill" className="shrink-0 text-good" />
                ) : (
                  <XCircleIcon size={22} weight="fill" className="shrink-0 text-bad" />
                )}
                <span className="min-w-0 flex-1">
                  {answered.chosen === trial.answer ? 'Right' : 'Not quite'}: it was <b>“{trial.word}”</b>. Hear both:
                </span>
                <span className="flex gap-2">
                  {trial.words.map((word) => (
                    <Button key={word} variant="secondary" size="sm" onClick={() => play(word, trial.voice)}>
                      <SpeakerHighIcon weight="fill" /> {word}
                    </Button>
                  ))}
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={next} disabled={!answered || save.isPending}>
                {index + 1 < list.length ? 'Next' : save.isPending ? 'Saving…' : 'See results'} <ArrowRightIcon weight="bold" />
                <Kbd className="ml-1 hidden bg-white/20 text-white sm:inline-flex">Enter</Kbd>
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
