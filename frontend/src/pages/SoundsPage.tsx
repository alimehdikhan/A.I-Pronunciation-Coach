import { MagnifyingGlassIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useMemo, useRef, useState } from 'react'
import { EmptyState, Segmented } from '@/components/common'
import { PageHeader } from '@/components/layout/AppShell'
import { DifficultyDots } from '@/components/tutor/PhonemeGuide'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useScrollReveal } from '@/lib/gsap'
import { trackSpotlight } from '@/lib/pointer'
import { describeSound, GROUP_PLAIN, voiceText } from '@/lib/plain'
import { useAnalytics, usePhonemes } from '@/lib/queries'
import type { PhonemeSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

type Filter = 'all' | PhonemeSummary['category']


function SoundTile({ phoneme, mistakes, onOpen }: { phoneme: PhonemeSummary; mistakes?: number; onOpen: () => void }) {
  const { spelled, word } = describeSound({ label: phoneme.label, phoneme: phoneme.symbol })
  // Consonants are told apart by whether the throat buzzes (think / this); vowels by more example words.
  const second = phoneme.category === 'consonant' ? voiceText(phoneme.voiced) : phoneme.examples.slice(1, 3).join(', ')
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerMove={trackSpotlight}
      title={`Tap to see how to make this sound (${phoneme.symbol})`}
      className="sound-tile spotlight lift surface flex flex-col items-start gap-3 rounded-[22px] p-4 text-left sm:p-5"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="text-[30px] leading-none font-semibold tracking-tight sm:text-[36px]">{spelled}</span>
        {mistakes ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-semibold text-bad">
            <WarningCircleIcon size={12} weight="fill" /> {mistakes}
          </span>
        ) : (
          <DifficultyDots level={phoneme.difficulty} />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight">as in {word || phoneme.examples[0]}</div>
        <div className="truncate text-[13px] text-muted-foreground">{second}</div>
      </div>
    </button>
  )
}

export default function SoundsPage() {
  const { data: phonemes, isLoading } = usePhonemes()
  const username = useSettings((s) => s.username)
  const { data: analytics } = useAnalytics(username)
  const openPhoneme = useUI((s) => s.openPhoneme)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const scope = useRef<HTMLDivElement>(null)

  const mistakes = useMemo(
    () => Object.fromEntries((analytics?.top_weaknesses ?? []).map((w) => [w.phoneme, w.count])),
    [analytics],
  )

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (phonemes ?? []).filter(
      (p) =>
        (filter === 'all' || p.category === filter) &&
        (!q || [p.symbol, p.label, p.name, ...p.examples].some((field) => field.toLowerCase().includes(q))),
    )
    const map = new Map<string, PhonemeSummary[]>()
    filtered.forEach((p) => map.set(p.group, [...(map.get(p.group) ?? []), p]))
    return [...map.entries()]
  }, [phonemes, filter, query])

  useScrollReveal(scope, '.sound-tile', [groups.length, filter, query, isLoading])

  return (
    <div ref={scope}>
      <PageHeader
        eyebrow="Sound Library"
        title="Every sound in English."
        description="All 41 sounds of American English. Tap one to see how to make it, hear examples, and practise words that sound almost alike."
      />

      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          layoutId="sound-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'consonant', label: 'Consonants' },
            { value: 'vowel', label: 'Vowels' },
            { value: 'diphthong', label: 'Two-part vowels' },
          ]}
        />
        <div className="relative sm:w-64">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sounds or words" className="h-9 pl-9" />
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-[22px]" />
          ))}
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <EmptyState icon={<MagnifyingGlassIcon />} title="No sounds match" description="Try a different word or sound." />
      )}

      <div className="space-y-10">
        {groups.map(([group, items]) => (
          <section key={group}>
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-[22px] font-semibold tracking-tight">{GROUP_PLAIN[group]?.title ?? group}</h2>
              <p className="hidden text-[14px] text-muted-foreground sm:block">{GROUP_PLAIN[group]?.hint}</p>
            </div>
            <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6')}>
              {items.map((p) => (
                <SoundTile key={p.symbol} phoneme={p} mistakes={mistakes[p.symbol]} onOpen={() => openPhoneme(p.symbol)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
