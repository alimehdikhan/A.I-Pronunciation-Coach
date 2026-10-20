import { CheckIcon, CopyIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { Attempt } from '@/store/practice'
import { useSettings } from '@/store/settings'

/** "Share with a teacher": stores this attempt's audio (with consent) behind a 7-day read-only link. */
export function ShareButton({ attempt }: { attempt: Attempt }) {
  const username = useSettings((s) => s.username)
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [copied, setCopied] = useState(false)
  const create = useMutation({
    mutationFn: () =>
      api.createShare(username, { recordId: attempt.result.record_id!, audio: attempt.audioBlob, analysis: attempt.result }),
  })
  const link = create.data ? `${window.location.origin}${create.data.path}` : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy. Select the link and copy it.')
    }
  }
  if (!attempt.result.record_id || !username) return null

  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)} className="h-12 px-6 text-[15px]">
        <ShareNetworkIcon weight="bold" /> Share with a teacher
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setConsent(false)
            setCopied(false)
            create.reset()
          }
        }}
      >
        <DialogContent className="gap-5 sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-xl">Share with a teacher</DialogTitle>
            <DialogDescription>
              Your teacher gets a link to hear this attempt and see its analysis, and can leave comments without an account. The
              link works for 7 days. Your name is not shown.
            </DialogDescription>
          </DialogHeader>
          {create.data ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" className="h-10" />
                <Button onClick={() => void copy()} className="h-10 shrink-0">
                  {copied ? <CheckIcon weight="bold" /> : <CopyIcon weight="bold" />} Copy
                </Button>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Works until {new Date(create.data.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. Comments
                appear on this attempt in your history. You can stop the link early from Profile.
              </p>
            </div>
          ) : (
            <>
              <label className="flex items-start gap-3 rounded-2xl bg-fill p-4 text-[14px] leading-relaxed">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  I agree that this recording is stored so that anyone with the link can play it for 7 days. After that, or if I stop
                  the link, the recording is deleted.
                </span>
              </label>
              <Button onClick={() => create.mutate()} disabled={!consent || create.isPending}>
                <ShareNetworkIcon weight="bold" /> {create.isPending ? 'Creating link…' : 'Create link'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
