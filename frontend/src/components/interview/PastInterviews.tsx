import { ArrowRightIcon, ClockCounterClockwiseIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, Panel, Pill, SectionLabel } from '@/components/common'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { InterviewSummary } from '@/lib/types'
import { relativeTime } from '@/lib/utils'
import { useSettings } from '@/store/settings'

/** Saved interviews, newest first: carry on with an unfinished one or open a report. */
export function PastInterviews({ onOpen, hideEmpty = false }: { onOpen: (summary: InterviewSummary) => void; hideEmpty?: boolean }) {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['interviews', username],
    queryFn: () => api.interviews(username),
    enabled: signedIn && !!username,
  })
  if (!signedIn || (hideEmpty && !isLoading && !data?.length)) return null

  return (
    <Panel className="p-5 sm:p-7">
      <SectionLabel icon={<ClockCounterClockwiseIcon weight="fill" />}>Your interviews</SectionLabel>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <p className="text-[14px] text-muted-foreground">Couldn’t load your interviews. Refresh to try again.</p>
      ) : !data?.length ? (
        <EmptyState
          className="py-10"
          icon={<ClockCounterClockwiseIcon weight="duotone" />}
          title="No interviews yet"
          description="Each interview you do is saved here, so you can come back to it and see your progress."
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {data.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="group flex w-full items-center gap-4 rounded-2xl px-2 py-3.5 text-left transition-colors duration-150 hover:bg-fill focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug font-semibold text-pretty">
                    {item.type_label}
                    {item.role_label ? ` · ${item.role_label}` : ''}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {relativeTime(item.created_at)} · {item.answered} of {item.total} answered
                    {item.content_score != null ? ` · content ${item.content_score}/5` : ''}
                  </span>
                </span>
                {!item.finished && <Pill tone="warn">Unfinished</Pill>}
                <span className="flex items-center gap-1 text-[13px] font-medium text-primary">
                  {item.finished ? 'Report' : 'Open'}
                  <ArrowRightIcon
                    weight="bold"
                    className="transition-transform duration-200 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5"
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
