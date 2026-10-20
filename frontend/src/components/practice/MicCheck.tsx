import { CheckCircleIcon, MicrophoneIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { recordingSupported } from '@/hooks/useRecorder'
import { registerMicCheck } from '@/lib/errors'
import { MIC_ADVICE, analyseMic, markMicChecked, measureFrame, type Frame, type MicReport } from '@/lib/micCheck'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'

const SECONDS = 3
type Phase = { kind: 'idle' } | { kind: 'recording'; level: number; left: number } | { kind: 'done'; report: MicReport } | { kind: 'error'; message: string }

/** Records three seconds with the same settings as a real recording and says what, if anything, to fix. */
function useMicCheck() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const stopRef = useRef<() => void>(() => undefined)

  useEffect(() => () => stopRef.current(), [])

  const start = useCallback(async () => {
    if (!recordingSupported) {
      setPhase({ kind: 'error', message: 'Recording is not supported in this browser. Try Chrome, Edge, Firefox or Safari.' })
      return
    }
    const context = new AudioContext()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
    } catch (error) {
      void context.close()
      const name = (error as DOMException)?.name
      setPhase({
        kind: 'error',
        message:
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Microphone access is blocked. Allow it from the address bar and try again.'
            : name === 'NotFoundError'
              ? 'No microphone was found. Plug one in and try again.'
              : 'Could not open the microphone. Is another app using it?',
      })
      return
    }
    if (context.state === 'suspended') await context.resume().catch(() => undefined)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    context.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const frames: Frame[] = []
    const started = performance.now()
    const stop = () => {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      void context.close().catch(() => undefined)
    }
    stopRef.current = stop
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      const frame = measureFrame(buffer)
      frames.push(frame)
      const elapsed = (performance.now() - started) / 1000
      if (elapsed >= SECONDS) {
        stop()
        markMicChecked()
        setPhase({ kind: 'done', report: analyseMic(frames) })
      } else {
        setPhase({ kind: 'recording', level: Math.min(1, frame.rms * 6), left: Math.ceil(SECONDS - elapsed) })
      }
    }, 50)
    setPhase({ kind: 'recording', level: 0, left: SECONDS })
  }, [])

  const reset = useCallback(() => {
    stopRef.current()
    setPhase({ kind: 'idle' })
  }, [])

  return { phase, start, reset }
}

function Report({ report }: { report: MicReport }) {
  if (!report.problems.length) {
    return (
      <div className="flex gap-3 rounded-2xl bg-good-soft p-4 text-[15px]" role="status">
        <CheckCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-good" />
        <div>
          <div className="font-semibold">Your microphone sounds good</div>
          <p className="mt-0.5 text-muted-foreground">Clear voice, well above the room noise ({Math.round(report.snrDb)} dB).</p>
        </div>
      </div>
    )
  }
  return (
    <ul className="space-y-2" role="status">
      {report.problems.map((problem) => (
        <li key={problem} className="flex gap-3 rounded-2xl bg-warn-soft p-4 text-[15px]">
          <WarningCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <div>
            <div className="font-semibold">{MIC_ADVICE[problem].title}</div>
            <p className="mt-0.5 text-muted-foreground">{MIC_ADVICE[problem].fix}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The mic check dialog, opened from Settings, from the practice page, or from an error toast. */
export function MicCheckDialog() {
  const open = useUI((s) => s.micCheckOpen)
  const setOpen = useUI((s) => s.setMicCheckOpen)
  const { phase, start, reset } = useMicCheck()

  useEffect(() => registerMicCheck(() => setOpen(true)), [setOpen])

  const onOpenChange = (next: boolean) => {
    if (!next) reset()
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Microphone check</DialogTitle>
          <DialogDescription>
            Three seconds. Press start, then say “One, two, three, I’m testing my microphone” at your normal volume.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'recording' && (
          <div className="space-y-2" aria-live="polite">
            <div className="h-3 overflow-hidden rounded-full bg-fill" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={phase.level}>
              <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${phase.level})` }} />
            </div>
            <div className="text-center text-[14px] text-muted-foreground">Listening… {phase.left}s</div>
          </div>
        )}
        {phase.kind === 'done' && <Report report={phase.report} />}
        {phase.kind === 'error' && (
          <p className="rounded-2xl bg-bad-soft p-4 text-[15px]" role="alert">
            {phase.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {phase.kind === 'done' ? 'Done' : 'Close'}
          </Button>
          <Button onClick={() => void start()} disabled={phase.kind === 'recording'} className={cn(phase.kind === 'recording' && 'opacity-60')}>
            <MicrophoneIcon weight="fill" /> {phase.kind === 'idle' ? 'Start' : 'Check again'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
