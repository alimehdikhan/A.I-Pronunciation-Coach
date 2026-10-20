import { ArrowLeftIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { LockedResults } from '@/components/auth/SignInGate'
import { Panel, Segmented } from '@/components/common'
import { GroupDiscussion } from '@/components/gd/GroupDiscussion'
import { CvSetup } from '@/components/interview/CvSetup'
import { InterviewReport } from '@/components/interview/InterviewReport'
import { InterviewRoom } from '@/components/interview/InterviewRoom'
import { InterviewSetup } from '@/components/interview/InterviewSetup'
import { PastInterviews } from '@/components/interview/PastInterviews'
import { Day30Link } from '@/components/progress/Day30'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { showError } from '@/lib/errors'
import type { InterviewDetail, InterviewStart } from '@/lib/types'
import { useInterviewPrefs } from '@/store/interview'
import { useSettings } from '@/store/settings'

interface Live {
  session: InterviewStart
  startIndex: number
  answered: number[]
}

/** A saved interview, ready to carry on from its first unanswered question. */
function resumeFrom(detail: InterviewDetail): Live {
  const answered = detail.questions.filter((q) => detail.answers[String(q.index)]).map((q) => q.index ?? 0)
  const next = detail.questions.find((q) => !detail.answers[String(q.index)])
  return {
    session: {
      id: detail.id,
      saved: true,
      type: detail.type,
      type_label: detail.type_label,
      role: detail.role,
      role_label: detail.role_label,
      level: detail.level,
      level_label: detail.level_label,
      questions: detail.questions,
      max_seconds: detail.max_seconds,
    },
    startIndex: next?.index ?? 0,
    answered,
  }
}

export type InterviewTab = 'mock' | 'cv' | 'group'

const HEADERS: Record<InterviewTab, { title: string; description: string }> = {
  mock: {
    title: 'Rehearse your interview.',
    description:
      'Choose the kind of interview, your role and experience. The interviewer asks every question aloud, follows up like a real one, and shows you what to improve.',
  },
  cv: {
    title: 'An interview about you.',
    description:
      'Add your CV and the job you want. The interviewer reads them and asks what a real interviewer would: about your own projects, your skills, and what the job needs.',
  },
  group: {
    title: 'Hold your own in a group.',
    description:
      'A group discussion like the ones in campus placements: three participants with their own views, a moderator, and you. Jump in, build on others, and summarise.',
  },
}

/** Mock interviews: set one up, take it with a spoken interviewer, then read the report. */
export default function InterviewPage({ tab = 'mock' }: { tab?: InterviewTab }) {
  const navigate = useNavigate()
  const username = useSettings((s) => s.username)
  const setPrefs = useInterviewPrefs((s) => s.set)
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const reportId = Number(params.get('report')) || null
  const [live, setLive] = useState<Live | null>(null)
  const [unsavedDone, setUnsavedDone] = useState(false)

  const stage = live ? 'live' : reportId ? 'report' : unsavedDone ? 'unsaved' : 'setup'
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [stage, reportId])

  const report = useQuery({
    queryKey: ['interview', username, reportId],
    queryFn: () => api.interview(username, reportId!),
    enabled: !!reportId && !!username,
  })

  const again = useMutation({
    mutationFn: (detail: InterviewDetail) =>
      // A CV interview has no bank to draw from: it is taken again with the same questions.
      detail.type === 'cv'
        ? api.repeatInterview(username, detail.id)
        : api.interviewStart({ type: detail.type, role: detail.role, level: detail.level, count: detail.total, username: username || undefined }),
    onSuccess: (session) => {
      setParams({})
      setLive({ session, startIndex: 0, answered: [] })
    },
    onError: showError,
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteInterview(username, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['interviews', username] })
      setParams({})
    },
    onError: showError,
  })

  const start = (session: InterviewStart) => {
    setUnsavedDone(false)
    setLive({ session, startIndex: 0, answered: [] })
  }

  const finished = () => {
    const session = live?.session
    setLive(null)
    void queryClient.invalidateQueries({ queryKey: ['interviews', username] })
    if (session?.saved && session.id != null) {
      void queryClient.invalidateQueries({ queryKey: ['interview', username, session.id] })
      setParams({ report: String(session.id) })
    } else setUnsavedDone(true)
  }

  if (stage === 'live' && live) {
    return (
      <InterviewRoom
        key={`${live.session.id ?? 'local'}-${live.startIndex}`}
        session={live.session}
        startIndex={live.startIndex}
        answered={live.answered}
        onFinish={finished}
        onExit={() => setLive(null)}
      />
    )
  }

  const tabs = (
    <Segmented<InterviewTab>
      layoutId="interview-tab"
      value={tab}
      onChange={(next) => navigate(next === 'mock' ? '/interview' : `/interview/${next}`)}
      options={[
        { value: 'mock', label: 'Mock interview' },
        { value: 'cv', label: 'From your CV' },
        { value: 'group', label: 'Group discussion' },
      ]}
    />
  )

  if (tab === 'group' && stage === 'setup') return <GroupDiscussion header={{ ...HEADERS.group, actions: tabs }} />

  const back = (
    <Button variant="ghost" size="sm" onClick={() => (setParams({}), setUnsavedDone(false))} className="-ml-2 mb-4">
      <ArrowLeftIcon weight="bold" /> All interviews
    </Button>
  )

  if (stage === 'report') {
    return (
      <>
        {back}
        {report.isLoading ? (
          <Skeleton className="h-96 w-full rounded-[30px]" />
        ) : report.isError || !report.data ? (
          <Panel className="p-8 text-center">
            <p className="text-[15px] text-muted-foreground">That interview couldn’t be loaded. It may have been deleted.</p>
          </Panel>
        ) : (
          <InterviewReport
            detail={report.data}
            onResume={() => setLive(resumeFrom(report.data!))}
            onAgain={() => {
              const d = report.data!
              if (d.type !== 'cv') setPrefs({ type: d.type, role: d.role, level: d.level, count: d.total })
              again.mutate(d)
            }}
            onNew={() => setParams({})}
            onDelete={() => remove.mutate(report.data!.id)}
            deleting={remove.isPending}
          />
        )}
      </>
    )
  }

  if (stage === 'unsaved') {
    return (
      <>
        {back}
        <LockedResults />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Interview prep"
        title={HEADERS[tab].title}
        description={HEADERS[tab].description}
        actions={tabs}
      />
      <div className="space-y-5">
        {tab === 'cv' ? <CvSetup onStart={start} /> : <InterviewSetup onStart={start} />}
        <PastInterviews onOpen={(item) => setParams({ report: String(item.id) })} />
        <Day30Link />
      </div>
    </>
  )
}
