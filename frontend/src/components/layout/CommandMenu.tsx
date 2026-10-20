import { describeSound } from '@/lib/plain'
import { GearSixIcon, MoonIcon, QuotesIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { usePhonemes } from '@/lib/queries'
import { PHRASES } from '@/lib/sentences'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { NAV } from './nav'

/** ⌘K palette: jump to pages, phrases and sounds. */
export function CommandMenu() {
  const open = useUI((s) => s.commandOpen)
  const setOpen = useUI((s) => s.setCommandOpen)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const openPhoneme = useUI((s) => s.openPhoneme)
  const setTarget = usePractice((s) => s.setTarget)
  const setLevel = useSettings((s) => s.setLevel)
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const { data: phonemes } = usePhonemes()
  const navigate = useNavigate()

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search phrases, sounds and pages" className="sm:max-w-xl">
      <CommandInput placeholder="Search phrases, sounds, pages…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {NAV.map(({ to, label, icon: IconComp }) => (
            <CommandItem key={to} value={`page ${label}`} onSelect={() => run(() => navigate(to))}>
              <IconComp />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Sounds">
          {phonemes?.map((p) => (
            <CommandItem
              key={p.symbol}
              value={`sound ${p.symbol} ${p.label} ${p.name} ${p.examples.join(' ')}`}
              onSelect={() => run(() => openPhoneme(p.symbol))}
            >
              <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-primary-soft px-1 text-[12px] font-semibold text-primary">
                {describeSound({ label: p.label, phoneme: p.symbol }).spelled}
              </span>
              <span className="truncate">{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Phrases">
          {PHRASES.map((phrase) => (
            <CommandItem
              key={phrase.id}
              value={`phrase ${phrase.text} ${phrase.category} ${phrase.level}`}
              onSelect={() =>
                run(() => {
                  setLevel(phrase.level)
                  setTarget({ text: phrase.text, source: 'library', phraseId: phrase.id })
                  navigate('/practice')
                })
              }
            >
              <QuotesIcon />
              <span className="truncate">{phrase.text}</span>
              <CommandShortcut className="tracking-normal capitalize">{phrase.level}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="settings voice name" onSelect={() => run(() => setSettingsOpen(true))}>
            <GearSixIcon /> Settings
          </CommandItem>
          <CommandItem value="toggle theme dark light appearance" onSelect={() => run(() => setTheme(theme === 'light' ? 'dark' : 'light'))}>
            <MoonIcon /> Toggle appearance
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
