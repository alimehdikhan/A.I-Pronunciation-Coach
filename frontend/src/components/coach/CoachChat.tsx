import { PaperPlaneTiltIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useChat } from '@/store/chat'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'

const STARTERS = [
  'How am I doing?',
  'How do I say mitochondria?',
  'What is the difference between ship and sheep?',
  'Give me sentences with the r sound',
]

/** The conversation itself: messages, suggestions and the box to type in. Lives inside the chat panel. */
export function CoachChat() {
  const username = useSettings((s) => s.username)
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
  const messages = useChat((s) => s.messages)
  const add = useChat((s) => s.add)
  const setOpen = useChat((s) => s.setOpen)
  const [draft, setDraft] = useState('')
  const reduce = useReducedMotion()
  const end = useRef<HTMLDivElement>(null)
  const setTarget = usePractice((s) => s.setTarget)
  const navigate = useNavigate()

  const ask = useMutation({
    mutationFn: (text: string) =>
      api.coachChat({
        username,
        message: text,
        native_language: nativeLanguage,
        history: useChat
          .getState()
          .messages.slice(-7, -1)
          .map(({ role, text: t }) => ({ role, text: t })),
      }),
    meta: { silent: true },
    onSuccess: (reply) =>
      add({
        role: 'coach',
        text: reply.reply,
        words: reply.words,
        sentences: reply.sentences,
        tryNext: reply.try_next,
        offline: reply.source === 'template',
      }),
    onError: () => add({ role: 'coach', text: 'I could not reach the coach just now. Please try again in a moment.', offline: true }),
  })

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
  }, [messages.length, ask.isPending, reduce])

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean || ask.isPending) return
    add({ role: 'learner', text: clean })
    setDraft('')
    ask.mutate(clean)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div>
            <p className="mb-3 text-[15px] text-muted-foreground">
              Hi! Ask me about a word, a sound, or what to practise. I answer from your own attempts.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => send(text)}
                  className="rounded-full bg-fill px-3.5 py-2 text-left text-[14px] transition-colors hover:bg-fill-strong"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={index}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={cn('flex', message.role === 'learner' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[90%] rounded-[20px] px-3.5 py-2.5 text-[15px] leading-relaxed',
                    message.role === 'learner' ? 'bg-primary text-primary-foreground' : 'bg-fill',
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {message.tryNext && (
                    <p className="mt-2 rounded-xl bg-background/60 px-3 py-2 text-[14px]">
                      <b>Try now:</b> {message.tryNext}
                    </p>
                  )}
                  {!!message.words?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.words.map((word) => (
                        <SpeakChip key={word} text={word} rate={0.8}>
                          {word}
                        </SpeakChip>
                      ))}
                    </div>
                  )}
                  {!!message.sentences?.length && (
                    <ul className="mt-3 space-y-2">
                      {message.sentences.map((sentence) => (
                        <li key={sentence.text} className="flex flex-col gap-2 rounded-xl bg-background/60 p-3">
                          <span className="text-[15px]">{sentence.text}</span>
                          <span className="flex items-center gap-2">
                            <SpeakChip text={sentence.text} rate={0.9}>
                              Listen
                            </SpeakChip>
                            <Button
                              size="sm"
                              onClick={() => {
                                setTarget({ text: sentence.text, source: 'custom' })
                                setOpen(false)
                                navigate('/practice')
                              }}
                            >
                              Practise
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {message.offline && <p className="mt-1.5 text-xs text-subtle">Built-in answer: the language model was not reachable.</p>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {ask.isPending && (
          <div className="flex" aria-label="The coach is writing">
            <div className="flex gap-1 rounded-[20px] bg-fill px-4 py-3.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-2 rounded-full bg-muted-foreground"
                  animate={reduce ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask your coach…"
          aria-label="Ask your coach"
          maxLength={400}
          className="h-11 flex-1"
        />
        <Button type="submit" size="lg" disabled={!draft.trim() || ask.isPending} aria-label="Send">
          <PaperPlaneTiltIcon weight="fill" />
        </Button>
      </form>
    </div>
  )
}
