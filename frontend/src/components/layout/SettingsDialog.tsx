import { GaugeIcon, MicrophoneIcon, TargetIcon, DesktopIcon, EyeSlashIcon, MoonIcon, PaletteIcon, PlayIcon, SpeakerHighIcon, SunIcon, TextTIcon, TranslateIcon, UserIcon, UserSoundIcon } from '@phosphor-icons/react'
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
import { useSettings, type Accent, type Goal, type Theme, type TipLanguage } from '@/store/settings'
import { useUI } from '@/store/ui'

const USERNAME_RE = /^[\p{L}\p{N}_ .'-]{0,40}$/u

/** iOS "inset grouped" list. */
function Group({ title, footer, icon, children }: { title?: string; footer?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section>
      {title && (
        <h3 className="mb-1.5 flex items-center gap-1.5 px-4 text-[13px] text-muted-foreground">
          {icon}
          {title}
        </h3>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-2xl bg-fill">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-xs text-subtle">{footer}</p>}
    </section>
  )
}

function Row({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
      <span className="flex items-center gap-2.5 text-[15px]">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {label}
      </span>
      <div className="flex min-w-0 shrink items-center justify-end">{children}</div>
    </div>
  )
}

export const NATIVE_LANGUAGES = [
  'Arabic', 'Bengali', 'Chinese (Mandarin)', 'French', 'German', 'Gujarati', 'Hindi', 'Indonesian', 'Italian',
  'Japanese', 'Korean', 'Marathi', 'Persian', 'Portuguese', 'Punjabi', 'Russian', 'Spanish', 'Tamil', 'Telugu',
  'Turkish', 'Urdu', 'Vietnamese', 'Other',
]

export const TIP_LANGUAGES: TipLanguage[] = ['English', 'Hindi', 'Urdu', 'Hinglish']

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

        <Group icon={<MicrophoneIcon size={14} weight="fill" />} title="Microphone" footer="Three seconds: checks your voice is loud enough, not distorting and clear of background noise.">
          <div className="p-2">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                useUI.getState().setSettingsOpen(false)
                useUI.getState().setMicCheckOpen(true)
              }}
            >
              <MicrophoneIcon weight="fill" /> Check my microphone
            </Button>
          </div>
        </Group>

        <Group icon={<TargetIcon size={14} weight="fill" />} title="Daily goal" footer="How many attempts to aim for each day. It shows on the practice page and your journey.">
          <div className="p-2">
            <Segmented<string>
              layoutId="settings-goal"
              value={String(settings.dailyGoal)}
              onChange={(v) => settings.setDailyGoal(Number(v))}
              className="w-full"
              options={[
                { value: '3', label: '3 a day', icon: <TargetIcon weight="bold" /> },
                { value: '5', label: '5 a day', icon: <TargetIcon weight="bold" /> },
                { value: '10', label: '10 a day', icon: <TargetIcon weight="bold" /> },
              ]}
            />
          </div>
        </Group>

        <Group icon={<UserIcon size={14} weight="fill" />} title="Profile" footer="History and streaks are stored under this name on the server.">
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

        <Group
          icon={<GaugeIcon size={14} weight="fill" />}
          title="Natural speed"
          footer="Slow, over-careful reading scores well but isn't how you talk. With this on, attempts under 100 words a minute are still scored and shown, but don't count toward your sounds, streak or daily goal. Word stress marks which syllable of each long word you stressed; it is experimental and often disagrees with expert listeners."
        >
          <Row label="Word stress (experimental)" icon={<GaugeIcon size={18} />}>
            <Switch checked={settings.stressCheck} onCheckedChange={settings.setStressCheck} aria-label="Check word stress (experimental)" />
          </Row>
          <Row label="Count only natural-speed attempts" icon={<GaugeIcon size={18} />}>
            <Switch
              checked={settings.naturalSpeed}
              onCheckedChange={settings.setNaturalSpeed}
              aria-label="Count only natural-speed attempts"
            />
          </Row>
        </Group>

        <Group icon={<TranslateIcon size={14} weight="fill" />} title="Your coach" footer="Your first language puts the sounds usually hard for its speakers first and lets the coach say why a slip happens; it never changes a score. “Be clearly understood” puts slips that change a word first. Saved with your profile.">
          <Row label="First language" icon={<TranslateIcon size={18} />}>
            <Select
              value={settings.nativeLanguage ?? '__none'}
              onValueChange={(value) => settings.setNativeLanguage(value === '__none' ? null : value)}
            >
              <SelectTrigger className="h-8 max-w-[190px] min-w-0 border-0 bg-transparent text-muted-foreground shadow-none dark:bg-transparent">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent position="popper" align="end" className="max-h-72">
                <SelectItem value="__none">Not set</SelectItem>
                {NATIVE_LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>
                    {language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Tips in" icon={<TranslateIcon size={18} />}>
            <Select value={settings.tipLanguage} onValueChange={(value) => settings.setTipLanguage(value as TipLanguage)}>
              <SelectTrigger className="h-8 max-w-[190px] min-w-0 border-0 bg-transparent text-muted-foreground shadow-none dark:bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {TIP_LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>
                    {language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <div className="p-2">
            <Segmented<Accent>
              layoutId="settings-accent"
              value={settings.accent}
              onChange={settings.setAccent}
              className="w-full"
              options={[
                { value: 'american', label: 'American English' },
                { value: 'british', label: 'British English' },
              ]}
            />
          </div>
          <div className="p-2">
            <Segmented<Goal>
              layoutId="settings-goal-kind"
              value={settings.goal}
              onChange={settings.setGoal}
              className="w-full"
              options={[
                { value: 'understood', label: 'Be clearly understood' },
                { value: 'accent', label: 'Reduce my accent' },
              ]}
            />
          </div>
        </Group>

        <Group icon={<PaletteIcon size={14} weight="fill" />} title="Appearance">
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

        <Group icon={<SpeakerHighIcon size={14} weight="fill" />} title="Coach voice" footer="The neural voice is analysed live, so the orb moves with it. Browser voices play without the orb.">
          <Row label="Voice" icon={<SpeakerHighIcon size={18} />}>
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
            <Row label="Coach" icon={<UserSoundIcon size={18} />}>
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

        <Group icon={<TextTIcon size={14} weight="fill" />} title="Under each word" footer="Plain letters show how to say a word (uh-BOWT). IPA is the exact phonetic alphabet.">
          <div className="p-2">
            <Segmented<'simple' | 'ipa' | 'off'>
              layoutId="phonetic-style"
              value={settings.phoneticStyle}
              onChange={settings.setPhoneticStyle}
              className="w-full"
              options={[
                { value: 'simple', label: 'Plain letters', icon: <TextTIcon weight="bold" /> },
                { value: 'ipa', label: 'IPA', icon: <TranslateIcon weight="bold" /> },
                { value: 'off', label: 'Hidden', icon: <EyeSlashIcon weight="bold" /> },
              ]}
            />
          </div>
        </Group>
      </DialogContent>
    </Dialog>
  )
}
