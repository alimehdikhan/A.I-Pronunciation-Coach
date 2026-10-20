import { useSoundName } from '@/lib/soundNames'
import { ChatTextIcon } from '@phosphor-icons/react'
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
    <div className="session-row py-3.5">
      <div className="flex items-center gap-4">
        <ScoreRing value={record.score} size={44} stroke={4}>
          <span className={cn('text-[13px] font-semibold tabular-nums', toneText[scoreTone(record.score)])}>{Math.round(record.score)}</span>
        </ScoreRing>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            setTarget({ text: record.target_text, source: 'custom' })
            navigate('/practice')
          }}
        >
          <div className="truncate text-[15px] font-medium hover:text-primary">{record.target_text}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[13px] text-subtle">
            <span>{relativeTime(record.created_at)}</span>
            {record.difficulty && <span className="capitalize">· {record.difficulty}</span>}
            {record.counted === false && (
              <span title="Careful (slow) speech with natural-speed mode on: not counted toward your sounds or goals">· not counted</span>
            )}
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
      {!!record.comments?.length && (
        <ul className="mt-2 ml-[60px] space-y-1.5">
          {record.comments.map((c, i) => (
            <li key={i} className="flex gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]">
              <ChatTextIcon size={16} weight="fill" className="mt-px shrink-0 text-primary" />
              <span>
                <b>{c.author || 'Teacher'}:</b> {c.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
