import { MagnifyingGlassIcon, SpinnerGapIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { Panel, Pill, Segmented, SectionLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useHistoryPages } from '@/lib/queries'
import type { HistoryFilters } from '@/lib/types'
import { SessionRow } from './SessionRow'

/** Every attempt, newest first: filter by how it went, search by phrase, load more as you scroll back. */
export function HistoryPanel({ username, bare = false }: { username: string; bare?: boolean }) {
  const [band, setBand] = useState<HistoryFilters['band']>('all')
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const { data, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } = useHistoryPages(username, {
    band,
    text: deferred,
  })
  const records = data?.pages.flatMap((p) => p.records) ?? []
  const total = data?.pages[0]?.total ?? 0
  const filtered = band !== 'all' || deferred.trim() !== ''

  const Shell = bare ? 'div' : Panel
  return (
    <Shell className={bare ? undefined : 'progress-item p-6 sm:p-8'}>
      {!bare && (
        <SectionLabel action={<Pill>{total} {filtered ? 'matching' : total === 1 ? 'session' : 'sessions'}</Pill>}>History</SectionLabel>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented<HistoryFilters['band']>
          layoutId="history-band"
          size="sm"
          value={band}
          onChange={setBand}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: 'Needs work' },
            { value: 'high', label: 'Great' },
          ]}
        />
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search your phrases"
            aria-label="Search your phrases"
            maxLength={80}
            className="h-9 pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={isFetching && !isFetchingNextPage ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="divide-y divide-border">
            <AnimatePresence initial={false} mode="popLayout">
              {records.map((record) => (
                <motion.div
                  key={record.id}
                  layout="position"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                >
                  <SessionRow record={record} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {records.length === 0 && (
            <p className="py-4 text-[15px] text-muted-foreground">
              {filtered ? 'No attempts match. Try another filter or a different word.' : 'Nothing here yet.'}
            </p>
          )}
        </div>
      )}

      {hasNextPage && (
        <Button variant="secondary" className="mt-4 w-full" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          {isFetchingNextPage ? <SpinnerGapIcon className="animate-spin" /> : null}
          Show {Math.min(15, total - records.length)} more
        </Button>
      )}
      <Button asChild variant="ghost" className="mt-2 w-full text-muted-foreground">
        <Link to="/drills">Work on your weakest sound</Link>
      </Button>
    </Shell>
  )
}
