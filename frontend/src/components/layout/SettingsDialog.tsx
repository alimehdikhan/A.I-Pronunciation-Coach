import { DesktopIcon, MoonIcon, PlayIcon, SunIcon } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Segmented } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useVoiceCatalog } from '@/lib/queries'
import { NEURAL_VOICE, rankVoice, useSpeaker, usesNeuralVoice, useVoices } from '@/lib/speech'
import { useSettings, type Theme } from '@/store/settings'
import { useUI } from '@/store/ui'

const USERNAME_RE = /^[\p{L}\p{N}_ .'-]{0,40}$/u

/** iOS "inset grouped" list. */
function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h3 className="mb-1.5 px-4 text-[13px] text-muted-foreground">{title}</h3>}
      <div className="divide-y divide-border overflow-hidden rounded-2xl bg-fill">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-xs text-subtle">{footer}</p>}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
      <span className="text-[15px]">{label}</span>
      <div className="flex min-w-0 shrink items-center justify-end">{children}</div>
    </div>
  )
}

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen)
  const setOpen = useUI((s) => s.setSettingsOpen)
  const settings = useSettings()
  const voices = useVoices()
  const { data: catalog } = useVoiceCatalog()
  const { speak } = useSpeaker()
  const [name, setName] = useState(settings.username)

  useEffect(() => {
    if (open) setName(settings.username)
  }, [open, settings.username])

  const sortedVoices = [...voices].sort((a, b) => rankVoice(b) - rankVoice(a))
  const voiceValue = usesNeuralVoice(settings.voiceURI) ? NEURAL_VOICE : settings.voiceURI!
  const nameValid = USERNAME_RE.test(name.trim())
  const coachChoice = settings.coachVoice ?? catalog?.default ?? ''

  const saveName = () => {
    if (!nameValid || name.trim() === settings.username) return
    settings.setUsername(name)
    toast.success(name.trim() ? `Saving progress as ${name.trim()}` : 'Practising as a guest')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-6 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription>Changes are saved automatically.</DialogDescription>
        </DialogHeader>

        <Group title="Profile" footer="History and streaks are stored under this name on the server.">
          <div className="px-4 py-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              placeholder="Your name (optional)"
              maxLength={40}
              aria-invalid={!nameValid}
              aria-label="Display name"
              className="h-10 border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </Group>

        <Group title="Appearance">
          <div className="p-2">
            <Segmented<Theme>
              layoutId="theme-seg"
              value={settings.theme}
              onChange={settings.setTheme}
              className="w-full"
              options={[
                { value: 'light', label: 'Light', icon: <SunIcon /> },
                { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
                { value: 'system', label: 'Automatic', icon: <DesktopIcon /> },
              ]}
            />
          </div>
        </Group>

        <Group title="Coach voice" footer="The neural voice is analysed live, so the orb moves with it. Browser voices play without the orb.">
          <Row label="Voice">
            <div className="flex min-w-0 items-center gap-1.5">
              <Select value={voiceValue} onValueChange={(value) => settings.setVoiceURI(value === NEURAL_VOICE ? null : value)}>
                <SelectTrigger className="h-8 max-w-[190px] min-w-0 border-0 bg-transparent text-muted-foreground shadow-none dark:bg-transparent">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent position="popper" align="end" className="max-h-72">
                  <SelectItem value={NEURAL_VOICE}>Neural coach (recommended)</SelectItem>
                  {sortedVoices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name.replace(/^(Microsoft|Google) /, '').replace(/ Online \(Natural\)/, ' (Natural)')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Preview voice"
                onClick={() => speak('The quick brown fox jumps over the lazy dog.', { key: 'settings-preview' })}
              >
                <PlayIcon weight="fill" className="text-primary" />
              </Button>
            </div>
          </Row>
          {voiceValue === NEURAL_VOICE && catalog && catalog.voices.length > 1 && (
            <Row label="Coach">
              <Select
                value={coachChoice}
                onValueChange={(value) => {
                  settings.setCoachVoice(value === catalog.default ? null : value)
                  speak('Hello, I am your pronunciation coach.', { key: 'settings-preview' })
                }}
              >
                <SelectTrigger className="h-8 max-w-[220px] min-w-0 border-0 bg-transparent text-muted-foreground shadow-none dark:bg-transparent">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent position="popper" align="end" className="max-h-72">
                  {catalog.voices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      {voice.name} · {voice.accent} {voice.gender}
                      {voice.speed === 'instant' ? ' · instant' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          )}
          <div className="px-4 py-3.5">
            <div className="mb-3 flex items-center justify-between text-[15px]">
              <span>Speaking rate</span>
              <span className="text-muted-foreground tabular-nums">{settings.rate.toFixed(2)}×</span>
            </div>
            <Slider min={0.6} max={1.2} step={0.05} value={[settings.rate]} onValueChange={([v]) => settings.setRate(v)} aria-label="Speaking rate" />
          </div>
        </Group>

        <Group>
          <Row label="Show IPA transcription">
            <Switch checked={settings.showIpa} onCheckedChange={settings.setShowIpa} aria-label="Show IPA transcription" />
          </Row>
        </Group>
      </DialogContent>
    </Dialog>
  )
}
