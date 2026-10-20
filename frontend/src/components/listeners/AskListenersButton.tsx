import { EarIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { errorLine } from '@/lib/errors'
import type { Attempt } from '@/store/practice'
import { useSettings } from '@/store/settings'

/** "Ask real listeners": other learners hear this attempt (anonymously) and type what they heard. */
export function AskListenersButton({ attempt }: { attempt: Attempt }) {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const share = useMutation({
    mutationFn: () => api.listenerShare(username, { recordId: attempt.result.record_id!, audio: attempt.audioBlob }),
    onSuccess: () => {
      setOpen(false)
      toast.success('Shared with real listeners', {
        description: 'Their results appear in Drills, under Real listeners.',
        action: { label: 'Open', onClick: () => window.location.assign('/drills?mode=listeners') },
      })
    },
  })
  if (!attempt.result.record_id || !username || !signedIn) return null

  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)} className="h-12 px-6 text-[15px]">
        <EarIcon weight="bold" /> Ask real listeners
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setConsent(false)
            share.reset()
          }
        }}
      >
        <DialogContent className="gap-5 sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-xl">Would a real person understand you?</DialogTitle>
            <DialogDescription>
              Other learners hear this recording and type what they heard. You see, word by word, what real people understood. They
              never see your name, and you never see theirs.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 rounded-2xl bg-fill p-4 text-[14px] leading-relaxed">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span>
              I agree that this recording is stored and played to other signed-in learners for 30 days. I can delete it any time, and it
              is deleted after 30 days or if someone reports it.{' '}
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
            </span>
          </label>
          {share.isError && <p className="text-[14px] text-bad">{errorLine(share.error)}</p>}
          <Button onClick={() => share.mutate()} disabled={!consent || share.isPending}>
            <EarIcon weight="bold" /> {share.isPending ? 'Sharing…' : 'Share with real listeners'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
