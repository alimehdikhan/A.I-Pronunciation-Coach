import { MagnifyingGlassIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useMemo, useRef, useState } from 'react'
import { EmptyState, Segmented } from '@/components/common'
import { PageHeader } from '@/components/layout/AppShell'
import { DifficultyDots } from '@/components/tutor/PhonemeGuide'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useScrollReveal } from '@/lib/gsap'
import { trackSpotlight } from '@/lib/pointer'
import { useAnalytics, usePhonemes } from '@/lib/queries'
import type { PhonemeSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

type Filter = 'all' | PhonemeSummary['category']

const GROUP_TITLES: Record<string, string> = {
  plosive: 'Plosives',
  fricative: 'Fricatives',
  affricate: 'Affricates',
  nasal: 'Nasals',
  liquid: 'Liquids',
  glide: 'Glides',
  front: 'Front vowels',
  central: 'Central vowels',
  back: 'Back vowels',
  'r-colored': 'R-coloured vowels',
  diphthong: 'Diphthongs',
}

const GROUP_HINTS: Record<string, string> = {
  plosive: 'Air is stopped completely, then released.',
  fricative: 'Air is squeezed through a narrow gap.',
  affricate: 'A stop that releases into a fricative.',
  nasal: 'Air flows through the nose.',
  liquid: 'Air flows around the tongue.',
  glide: 'A quick movement into the next vowel.',
  front: 'Tongue raised toward the front of the mouth.',
  central: 'Tongue relaxed in the middle.',
  back: 'Tongue raised toward the back.',
  'r-colored': 'Vowels shaped by an American r.',
  diphthong: 'Glide from one vowel into another.',
}

function SoundTile({ phoneme, mistakes, onOpen }: { phoneme: PhonemeSummary; mistakes?: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerMove={trackSpotlight}
      className="sound-tile spotlight lift surface flex flex-col items-start gap-3 rounded-[22px] p-4 text-left sm:p-5"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="ipa text-[34px] leading-none font-medium sm:text-[40px]">{phoneme.symbol}</span>
        {mistakes ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-semibold text-bad">
            <WarningCircleIcon size={12} weight="fill" /> {mistakes}
          </span>
        ) : (
          <DifficultyDots level={phoneme.difficulty} />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight">{phoneme.examples[0]}</div>
        <div className="truncate text-[13px] text-muted-foreground">{phoneme.label}</div>
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
        description="All 41 sounds of American English, with mouth guides, examples and minimal pairs you can hear."
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
            { value: 'diphthong', label: 'Diphthongs' },
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
        <EmptyState icon={<MagnifyingGlassIcon />} title="No sounds match" description="Try a different word or symbol." />
      )}

      <div className="space-y-10">
        {groups.map(([group, items]) => (
          <section key={group}>
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-[22px] font-semibold tracking-tight">{GROUP_TITLES[group] ?? group}</h2>
              <p className="hidden text-[14px] text-muted-foreground sm:block">{GROUP_HINTS[group]}</p>
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
