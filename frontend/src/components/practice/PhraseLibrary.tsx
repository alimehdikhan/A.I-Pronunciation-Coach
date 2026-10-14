import { CheckIcon, MagnifyingGlassIcon, TextAaIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Segmented } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORIES, LEVELS, PHRASES, type Category } from '@/lib/sentences'
import type { Level } from '@/lib/types'
import { cn } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

type Tab = Level | 'custom'

export function PhraseLibrary() {
  const open = useUI((s) => s.libraryOpen)
  const setOpen = useUI((s) => s.setLibraryOpen)
  const level = useSettings((s) => s.level)
  const setLevel = useSettings((s) => s.setLevel)
  const target = usePractice((s) => s.target)
  const setTarget = usePractice((s) => s.setTarget)

  const [tab, setTab] = useState<Tab>(level)
  const [category, setCategory] = useState<Category | 'All'>('All')
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState(target.source === 'custom' ? target.text : '')

  useEffect(() => {
    if (!open) return
    setTab(target.source === 'custom' ? 'custom' : level)
    setQuery('')
    if (target.source === 'custom') setCustom(target.text)
  }, [open, level, target])

  const phrases = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PHRASES.filter(
      (p) =>
        (tab === 'custom' || p.level === tab) &&
        (category === 'All' || p.category === category) &&
        (!q || p.text.toLowerCase().includes(q)),
    )
  }, [tab, category, query])

  const customValid = custom.trim().length > 0 && custom.trim().length <= 300 && /[a-z0-9]/i.test(custom)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-5 sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Choose a phrase</DialogTitle>
          <DialogDescription>Pick from the library or practise your own words.</DialogDescription>
        </DialogHeader>

        <Segmented<Tab>
          layoutId="library-tab"
          value={tab}
          onChange={setTab}
          className="w-full"
          options={[...LEVELS.map((l) => ({ value: l.id as Tab, label: l.label })), { value: 'custom', label: 'Your text' }]}
        />

        {tab === 'custom' ? (
          <div className="space-y-3">
            <Textarea
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={300}
              placeholder="Type or paste anything — a line from a talk, an interview answer, a tricky word…"
              className="min-h-36 resize-none rounded-2xl p-4 text-[17px] leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-subtle tabular-nums">{custom.trim().length}/300</span>
              <Button
                size="lg"
                disabled={!customValid}
                onClick={() => {
                  setTarget({ text: custom.trim().replace(/\s+/g, ' '), source: 'custom' })
                  setOpen(false)
                }}
              >
                <TextAaIcon weight="bold" /> Practise this
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-9 pl-9" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['All', ...CATEGORIES] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'h-7 rounded-full px-3 text-xs font-medium transition-colors',
                      category === c ? 'bg-foreground text-background' : 'bg-fill text-muted-foreground hover:bg-fill-strong',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <ScrollArea className="-mx-2 min-h-0 flex-1">
              <div className="space-y-1 px-2 pb-1">
                {phrases.map((phrase) => {
                  const active = phrase.text === target.text
                  return (
                    <button
                      key={phrase.id}
                      onClick={() => {
                        setLevel(phrase.level)
                        setTarget({ text: phrase.text, source: 'library', phraseId: phrase.id })
                        setOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors',
                        active ? 'bg-primary-soft' : 'hover:bg-fill',
                      )}
                    >
                      <span className={cn('flex-1 text-[15px] leading-snug', active && 'font-medium text-primary')}>{phrase.text}</span>
                      <span className="shrink-0 text-xs text-subtle">{phrase.category}</span>
                      {active && <CheckIcon size={16} weight="bold" className="shrink-0 text-primary" />}
                    </button>
                  )
                })}
                {!phrases.length && <p className="py-10 text-center text-sm text-muted-foreground">No phrases match.</p>}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
