import { TargetIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { usePhoneme } from '@/lib/queries'
import { useUI } from '@/store/ui'
import { PhonemeGuide } from './PhonemeGuide'

/** Global slide-over with the full guide for a phoneme (opened via useUI.openPhoneme). */
export function PhonemeSheet() {
  const symbol = useUI((s) => s.phonemeSheet)
  const openPhoneme = useUI((s) => s.openPhoneme)
  const { data, isLoading, isError } = usePhoneme(symbol)
  const navigate = useNavigate()
  const close = () => openPhoneme(null)

  return (
    <Sheet open={!!symbol} onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-[460px]">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-[13px] font-semibold text-muted-foreground">Sound Library</SheetTitle>
          <SheetDescription className="sr-only">Guide for the sound /{symbol}/</SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-8">
          {isLoading && (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
          )}
          {isError && <p className="text-sm text-muted-foreground">This sound isn’t in the library.</p>}
          {data && (
            <>
              <PhonemeGuide phoneme={data} onNavigate={close} />
              <Button
                variant="secondary"
                size="lg"
                className="mt-8 w-full"
                onClick={() => {
                  close()
                  navigate(`/drills?sound=${encodeURIComponent(data.symbol)}`)
                }}
              >
                <TargetIcon weight="bold" /> Drill this sound
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
