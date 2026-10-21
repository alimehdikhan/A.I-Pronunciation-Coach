import { ArrowLeftIcon, ArrowRightIcon, FileArrowUpIcon, FileTextIcon, ShieldCheckIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Panel, Pill, Segmented } from '@/components/common'
import { ContinueBar, Field, LevelAndLength, StartBar, StepBody, StepHeader, StyleAndOptions } from '@/components/interview/setupParts'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { errorLine } from '@/lib/errors'
import type { InterviewStart } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useInterviewPrefs } from '@/store/interview'
import { useSettings } from '@/store/settings'

const ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'
const MAX_BYTES = 2 * 1024 * 1024
const COUNTS = [3, 5, 7]
const PRIVACY =
  'Your CV is read once to write the questions and is never stored. Emails, phone numbers and links are removed before anything goes to the AI.'

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The CV as a file: dropped on the box or chosen. */
function DropZone({ file, onFile }: { file: File | null; onFile: (file: File | null, problem?: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const take = (picked: File | undefined) => {
    if (!picked) return
    if (!/\.(pdf|docx|txt)$/i.test(picked.name)) return onFile(null, 'Choose a PDF, Word (.docx) or text file.')
    if (picked.size > MAX_BYTES) return onFile(null, 'That file is over 2 MB. Paste the text instead.')
    onFile(picked)
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-fill px-4 py-3.5">
        <FileTextIcon size={26} weight="fill" className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{file.name}</div>
          <div className="text-[13px] text-muted-foreground">{sizeLabel(file.size)}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onFile(null)} aria-label="Remove this file">
          <XIcon weight="bold" /> Remove
        </Button>
      </div>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer.files?.[0])
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-[border-color,background-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none',
          over ? 'border-primary bg-primary-soft' : 'border-border hover:bg-fill',
        )}
      >
        <FileArrowUpIcon size={30} weight="duotone" className="text-primary" />
        <span className="text-[15px] font-medium">Drop your CV here, or choose a file</span>
        <span className="text-[13px] text-muted-foreground">PDF, Word or text, up to 2 MB</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          take(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )
}

/** After the CV is read: what the questions are based on, before the interview begins. */
function Ready({ session, onBegin, onBack }: { session: InterviewStart; onBegin: () => void; onBack: () => void }) {
  const read = session.read
  const chips = (items: string[] | undefined, tone: 'good' | 'warn' | 'neutral') =>
    items?.length ? (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Pill key={item} tone={tone}>
            {item}
          </Pill>
        ))}
      </div>
    ) : null
  return (
    <Panel className="p-6 sm:p-8">
      <h2 className="headline text-[28px] tracking-[-0.02em] sm:text-[32px]">Your interview is ready.</h2>
      <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-muted-foreground">
        {session.questions.length} questions about your own experience
        {read?.job_title ? ` for the ${read.job_title} role` : ''}. Answer as you would in the real interview.
      </p>
      {read && (
        <dl className="mt-7 grid gap-5 sm:grid-cols-2">
          {read.current_role && (
            <div>
              <dt className="text-[13px] font-medium text-muted-foreground">Your current role</dt>
              <dd className="mt-1 text-[15px] font-medium">{read.current_role}</dd>
            </div>
          )}
          {read.job_title && (
            <div>
              <dt className="text-[13px] font-medium text-muted-foreground">The job</dt>
              <dd className="mt-1 text-[15px] font-medium">{read.job_title}</dd>
            </div>
          )}
          {read.projects.length > 0 && (
            <div>
              <dt className="text-[13px] font-medium text-muted-foreground">Projects we may ask about</dt>
              <dd className="mt-1.5">{chips(read.projects, 'neutral')}</dd>
            </div>
          )}
          {(read.shared_skills.length > 0 || read.skills.length > 0) && (
            <div>
              <dt className="text-[13px] font-medium text-muted-foreground">
                {read.shared_skills.length ? 'Skills the job wants that you have' : 'Skills on your CV'}
              </dt>
              <dd className="mt-1.5">{chips(read.shared_skills.length ? read.shared_skills : read.skills.slice(0, 8), 'good')}</dd>
            </div>
          )}
          {read.missing_skills.length > 0 && (
            <div>
              <dt className="text-[13px] font-medium text-muted-foreground">The job asks for, not on your CV</dt>
              <dd className="mt-1.5">{chips(read.missing_skills, 'warn')}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="mt-6 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <SparkleIcon weight="fill" className="text-primary" />
        {session.source === 'groq'
          ? 'Questions written by the AI coach from your CV.'
          : 'Questions built from the skills and projects on your CV.'}
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button size="lg" className="h-12 px-7 text-[15px]" onClick={onBegin}>
          Start interview <ArrowRightIcon weight="bold" />
        </Button>
        <Button variant="secondary" size="lg" className="h-12" onClick={onBack}>
          <ArrowLeftIcon weight="bold" /> Change my CV
        </Button>
      </div>
    </Panel>
  )
}

/** "Interview from your CV": the learner's CV (and the job) become a real interview. */
export function CvSetup({ onStart }: { onStart: (session: InterviewStart) => void }) {
  const prefs = useInterviewPrefs()
  const username = useSettings((s) => s.username)
  const { data: options } = useQuery({
    queryKey: ['interview-options'],
    queryFn: api.interviewOptions,
    staleTime: Infinity,
  })
  const [source, setSource] = useState<'upload' | 'paste'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [jobAd, setJobAd] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [ready, setReady] = useState<InterviewStart | null>(null)
  const [step, setStep] = useState<'cv' | 'how'>('cv')
  const write = useMutation({
    mutationFn: api.interviewFromCv,
    onSuccess: (session) => {
      setProblem(null)
      setReady(session)
    },
    onError: (error) => setProblem(errorLine(error)),
  })

  if (ready) return <Ready session={ready} onBegin={() => onStart(ready)} onBack={() => setReady(null)} />

  const count = COUNTS.includes(prefs.count) ? prefs.count : 5
  const hasCv = source === 'upload' ? !!file : text.trim().length >= 80
  const needCv = () => {
    if (hasCv) return false
    setProblem(source === 'upload' ? 'Add your CV first: drop the file or choose it.' : 'Paste your CV first: a few lines at least.')
    return true
  }
  const begin = () => {
    if (needCv()) {
      setStep('cv')
      return
    }
    write.mutate({
      file: source === 'upload' ? file : null,
      text: source === 'paste' ? text : undefined,
      jobAd,
      level: prefs.level,
      count,
      username: username || undefined,
    })
  }

  return (
    <Panel className="p-5 sm:p-8">
      {step === 'cv' ? (
        <StepHeader index={0} total={2} title="Your CV and the job" hint="The interviewer asks about what is on your CV." />
      ) : (
        <StepHeader index={1} total={2} title="How should it go?" onBack={() => setStep('cv')} />
      )}
      <StepBody step={step}>
        {step === 'cv' ? (
          <div className="space-y-9">
            <Field title="Your CV or resume" hint="Upload the file or paste the text.">
              <Segmented
                layoutId="cv-source"
                value={source}
                onChange={(value) => {
                  setSource(value)
                  setProblem(null)
                }}
                options={[
                  { value: 'upload', label: 'Upload a file' },
                  { value: 'paste', label: 'Paste your resume or CV' },
                ]}
              />
              <div className="mt-3.5">
                {source === 'upload' ? (
                  <DropZone
                    file={file}
                    onFile={(picked, why) => {
                      setFile(picked)
                      setProblem(why ?? null)
                    }}
                  />
                ) : (
                  <>
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Paste your resume or CV here: your experience, projects, skills and education."
                      aria-label="Your resume or CV"
                      maxLength={30000}
                      className="min-h-56 rounded-2xl text-[15px] leading-relaxed"
                    />
                    <p className="mt-1.5 text-right text-[12px] text-subtle tabular-nums">{text.length.toLocaleString()} characters</p>
                  </>
                )}
              </div>
            </Field>

            <Field
              title="The job (optional)"
              hint="Paste the job advert, and the questions match that job: its title, its must-have skills and what your CV lacks."
            >
              <Textarea
                value={jobAd}
                onChange={(e) => setJobAd(e.target.value)}
                placeholder="Backend Engineer, FinPay. We are looking for… (paste the job description)"
                aria-label="The job advert"
                maxLength={12000}
                className="min-h-32 rounded-2xl text-[15px] leading-relaxed"
              />
            </Field>

            {problem && <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[14px] text-bad">{problem}</p>}
            <ContinueBar onContinue={() => !needCv() && setStep('how')}>
              <span className="flex gap-2">
                <ShieldCheckIcon size={18} weight="fill" className="mt-px shrink-0 text-good" />
                Never stored.
              </span>
            </ContinueBar>
          </div>
        ) : (
          <div className="space-y-9">
            <LevelAndLength levels={options?.levels ?? []} counts={COUNTS} showLevel={!!options} />
            <StyleAndOptions />

            {problem && <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[14px] text-bad">{problem}</p>}
            <StartBar
              label={write.isPending ? 'Reading your CV…' : 'Write my questions'}
              pending={write.isPending}
              onStart={begin}
              note={
                <span className="flex gap-2">
                  <ShieldCheckIcon size={18} weight="fill" className="mt-px shrink-0 text-good" />
                  {PRIVACY}
                </span>
              }
            />
          </div>
        )}
      </StepBody>
    </Panel>
  )
}
