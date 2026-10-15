import { SpeakChip } from '@/components/tutor/SpeakButton'

/** The words that keep going wrong. Tap one to hear it slowly. */
export function TrickyWords({ words }: { words: { word: string; misses: number }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {words.map((w) => (
        <SpeakChip key={w.word} text={w.word} rate={0.8} tone="bad">
          {w.word}
          <span className="ml-1 text-[12px] opacity-70">{w.misses}×</span>
        </SpeakChip>
      ))}
    </div>
  )
}
