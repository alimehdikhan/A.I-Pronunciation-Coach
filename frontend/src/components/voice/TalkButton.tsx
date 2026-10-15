import { MicrophoneIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useHealth } from '@/lib/queries'
import { useVoiceUI } from '@/store/voice'

/** Opens the spoken conversation. Not shown when the server has no voice agent switched on. */
export function TalkButton({ className }: { className?: string }) {
  const { data: health } = useHealth()
  const open = useVoiceUI((s) => s.setOpen)
  if (!health?.voice_agent) return null
  return (
    <Button variant="secondary" size="sm" className={className} onClick={() => open(true)}>
      <MicrophoneIcon weight="fill" className="text-primary" /> Talk to your coach
    </Button>
  )
}
