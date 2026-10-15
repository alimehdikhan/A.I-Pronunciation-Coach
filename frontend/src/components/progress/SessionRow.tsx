import { useSoundName } from '@/lib/soundNames'
import { useNavigate } from 'react-router'
import { ScoreRing } from '@/components/ui/score-ring'
import type { HistoryRecord } from '@/lib/types'
import { cn, relativeTime, scoreTone, toneText } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useUI } from '@/store/ui'

/** One past attempt: its score, the phrase (tap to practise it again) and the sounds that slipped. */
export function SessionRow({ record }: { record: HistoryRecord }) {
  const setTarget = usePractice((s) => s.setTarget)
  const navigate = useNavigate()
  const openPhoneme = useUI((s) => s.openPhoneme)
  const soundName = useSoundName()
  const sounds = [...new Set(record.mistakes.map((m) => m.expected_phoneme))].slice(0, 4)
  return (
    <div className="session-row flex items-center gap-4 py-3.5">
      <ScoreRing value={record.score} size={44} stroke={4}>
        <span className={cn('text-[13px] font-semibold tabular-nums', toneText[scoreTone(record.score)])}>{Math.round(record.score)}</span>
      </ScoreRing>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          setTarget({ text: record.target_text, source: 'custom' })
          navigate('/')
        }}
      >
        <div className="truncate text-[15px] font-medium hover:text-primary">{record.target_text}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-subtle">
          <span>{relativeTime(record.created_at)}</span>
          {record.difficulty && <span className="capitalize">· {record.difficulty}</span>}
        </div>
      </button>
      <div className="hidden shrink-0 gap-1 sm:flex">
        {sounds.map((symbol) => (
          <button
            key={symbol}
            onClick={() => openPhoneme(symbol)}
            title={`The ${soundName(symbol).text} sound`}
            className="grid h-7 min-w-7 place-items-center rounded-full bg-bad-soft px-2 text-[13px] font-medium text-bad hover:brightness-110"
          >
            {soundName(symbol).spelled}
          </button>
        ))}
      </div>
    </div>
  )
}
