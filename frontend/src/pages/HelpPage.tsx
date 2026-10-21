import {
  ArrowRightIcon,
  BriefcaseIcon,
  ChalkboardTeacherIcon,
  ChartLineUpIcon,
  ChatsCircleIcon,
  ClipboardTextIcon,
  EarIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  UserCirclePlusIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { DocLayout, DocSection } from '@/components/site/DocLayout'
import { useTunedLanguages } from '@/lib/queries'
import { scrollToHash } from '@/components/site/SiteFooter'
import { Kbd } from '@/components/ui/kbd'

const TOC = [
  { id: 'getting-started', title: 'Getting started' },
  { id: 'practice', title: 'Practise sentences' },
  { id: 'interview', title: 'Interview prep' },
  { id: 'speak', title: 'Speak freely and IELTS' },
  { id: 'listening', title: 'Listening and real listeners' },
  { id: 'coach', title: 'Your coach' },
  { id: 'progress', title: 'Progress and before & after' },
  { id: 'settings', title: 'Settings that help' },
  { id: 'shortcuts', title: 'Keyboard shortcuts' },
  { id: 'faq', title: 'Questions' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
]

const STEPS: { icon: Icon; title: string; text: ReactNode }[] = [
  {
    icon: UserCirclePlusIcon,
    title: 'Create a free account',
    text: (
      <>
        <Link to="/signup">Sign up</Link> with your email. Your progress, interviews and recordings are kept with your account.
      </>
    ),
  },
  {
    icon: MicrophoneIcon,
    title: 'Check your microphone',
    text: 'Allow the microphone when your browser asks, then run the 3-second mic check. A quiet room helps.',
  },
  {
    icon: ClipboardTextIcon,
    title: 'Take the 2-minute check-up',
    text: (
      <>
        Say six short sentences in the <Link to="/checkup">check-up</Link>. The coach finds the sounds to start with and the level that
        suits you.
      </>
    ),
  },
  {
    icon: ChartLineUpIcon,
    title: 'Practise a few minutes a day',
    text: 'Short, daily practice beats one long session. Your streak and goals keep you going.',
  },
]

const GUIDES: { id: string; icon: Icon; title: string; text: string }[] = [
  { id: 'practice', icon: MicrophoneIcon, title: 'Practise sentences', text: 'Every word and sound, checked.' },
  { id: 'interview', icon: BriefcaseIcon, title: 'Interview prep', text: 'Mock interviews, your CV, group discussions.' },
  { id: 'speak', icon: ChatsCircleIcon, title: 'Speak freely', text: 'Answer in your own words, IELTS cue cards.' },
  { id: 'listening', icon: EarIcon, title: 'Listening', text: 'Train your ear; let real people listen to you.' },
  { id: 'coach', icon: ChalkboardTeacherIcon, title: 'Your coach', text: 'A guided session and voice conversations.' },
  { id: 'progress', icon: ChartLineUpIcon, title: 'Progress', text: 'Trends, streaks, Day 1 vs Day 30.' },
]

const SHORTCUTS: [string, string[], string][] = [
  ['Anywhere', ['Ctrl', 'K'], 'Search pages, sounds and phrases (⌘K on a Mac)'],
  ['Practice', ['Space'], 'Start or stop recording'],
  ['Practice', ['R'], 'Try the same phrase again'],
  ['Practice', ['N'], 'Next phrase (← and → move between phrases)'],
  ['Practice', ['L'], 'Listen to the phrase'],
  ['Practice', ['M'], 'Microphone check'],
  ['Practice', ['C'], 'Say a “Worth checking” word on its own'],
  ['Interview', ['Space'], 'Answer, or finish your answer'],
  ['Interview', ['R'], 'Hear the question again'],
  ['Interview', ['T'], 'Tips (practice mode)'],
  ['Interview', ['N'], 'Next question (practice mode)'],
  ['Group discussion', ['Space'], 'Jump in, or finish your point'],
  ['Group discussion', ['T'], 'Show the transcript'],
  ['Listening drills', ['←', '→'], 'Pick the first or second word'],
  ['Listening drills', ['Space'], 'Hear the word again'],
  ['Speak freely', ['S'], 'Skip the preparation time'],
]

const FAQ: { q: string; a: ReactNode }[] = [
  { q: 'Is it free?', a: 'Yes. Creating an account and practising are free.' },
  {
    q: 'Do you keep my recordings?',
    a: (
      <>
        No. Practice recordings are analysed and thrown away. Audio is kept only for features you choose: before &amp; after, a teacher
        link, or real listeners, and you can delete it any time. See the <Link to="/privacy">Privacy Policy</Link>.
      </>
    ),
  },
  {
    q: 'What is the difference between “Fix this” and “Worth checking”?',
    a: '“Fix this” means the coach is fairly sure a sound slipped. “Worth checking” means it isn’t sure: tap “Say just this word” to settle it. Only “Fix this” counts against your progress.',
  },
  {
    q: 'Is the score my IELTS score?',
    a: 'No. It is an estimate of how clearly you pronounced the words, checked against expert ratings. It is not an official exam score of any kind.',
  },
  {
    q: 'Why does it want me to sign in to see my feedback?',
    a: 'Your feedback is saved with your account, so you can come back to it, see your progress, and carry on unfinished interviews on any device.',
  },
  {
    q: 'Is my CV stored when I use “From your CV”?',
    a: 'No. It is read once to write your questions. Email addresses, phone numbers and links are removed before anything is sent to the AI. Only the questions are saved with your interview.',
  },
  {
    q: 'Who are Alex, Priya, Rahul and Meera?',
    a: 'They are simulated by the app: Alex is the interviewer and the moderator, and Priya, Rahul and Meera take part in group discussions. They are not real people.',
  },
  {
    q: 'Can I use it on my phone?',
    a: 'Yes, in Chrome or Safari on a recent phone. Use headphones if you can, so the app doesn’t hear its own voice.',
  },
  {
    q: 'I disagree with a result. What can I do?',
    a: 'Tap “I think this is wrong” on the sound. It doesn’t change your score, but it helps improve the scoring.',
  },
  {
    q: 'How do I delete my data?',
    a: (
      <>
        Go to your <Link to="/profile">Profile</Link>. You can delete your practice history, stored recordings, or your whole account.
      </>
    ),
  },
]

const TROUBLE: { q: string; a: ReactNode }[] = [
  {
    q: 'The microphone is blocked',
    a: 'Click the lock or settings icon next to the web address, allow the microphone for this site, then reload. On a phone, check that your browser has microphone permission in the phone’s settings.',
  },
  {
    q: '“The speech models are still warming up”',
    a: 'The server loads its speech models after it starts, which takes about a minute. Wait for the countdown, then try again.',
  },
  {
    q: '“We didn’t hear any speech”',
    a: 'Check that the right microphone is selected, speak a little closer to it, and run the mic check from Practice (press M).',
  },
  {
    q: 'I can’t hear the coach or the interviewer',
    a: 'Check your volume and that the tab isn’t muted. If the natural voice can’t load, the app uses your browser’s voice instead, which sounds different.',
  },
  {
    q: 'Results seem wrong',
    a: 'Background noise, music or another person talking can confuse the scorer. Try a quieter room and hold the device about a hand’s width from your mouth.',
  },
  {
    q: '“That was a lot of recordings in a minute”',
    a: 'There is a short limit on how many recordings can be scored per minute. Take a breath and try again when the countdown ends.',
  },
  {
    q: 'Scrolling or animations feel slow',
    a: 'Close other heavy tabs. On Windows, turn on Settings → Accessibility → Visual effects → Animation effects for smooth scrolling in Chrome.',
  },
]

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  )
}

function Accordion({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl ring-1 ring-border">
      {items.map((item) => (
        <details key={item.q} className="group bg-card/40 px-5 open:bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15.5px] font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden className="text-[20px] leading-none text-subtle transition-transform duration-200 group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="pb-5 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-primary">{item.a}</div>
        </details>
      ))}
    </div>
  )
}

/** Text of a FAQ answer, for search. */
function plain(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(plain).join(' ')
  if (node && typeof node === 'object' && 'props' in node) return plain((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

/** How to use Vocaly AI: getting started, a guide to each feature, shortcuts, questions and fixes. */
export function HelpPage() {
  const tuned = useTunedLanguages()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const faq = useMemo(() => FAQ.filter((f) => !q || `${f.q} ${plain(f.a)}`.toLowerCase().includes(q)), [q])
  const trouble = useMemo(() => TROUBLE.filter((f) => !q || `${f.q} ${plain(f.a)}`.toLowerCase().includes(q)), [q])

  return (
    <DocLayout
      title="How to use Vocaly AI"
      tabTitle="Help centre"
      toc={TOC}
      wide
      intro="Everything you need to get started, a short guide to each feature, and answers to common questions."
    >
      <div className="relative max-w-xl">
        <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value.trim()) scrollToHash('faq')
          }}
          placeholder="Search questions and fixes"
          aria-label="Search questions and fixes"
          className="h-12 w-full rounded-full bg-fill pr-4 pl-11 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <DocSection id="getting-started" title="Getting started">
        {/* Cards, not prose: the list keeps its meaning but none of the document list styling. */}
        <ol className="grid list-none gap-3 pl-0 sm:grid-cols-2 [&>li]:m-0">
          {STEPS.map(({ icon: IconComp, title, text }, i) => (
            <li key={title} className="flex gap-4 rounded-[22px] bg-fill p-5 sm:p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-primary-soft text-primary">
                <IconComp size={22} weight="duotone" />
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold tracking-[0.01em] text-subtle tabular-nums">Step {i + 1}</div>
                <div className="mt-0.5 text-[16.5px] leading-snug font-semibold text-foreground">{title}</div>
                <p className="mt-1.5 text-[14.5px] leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <h3>Find your way around</h3>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {GUIDES.map(({ id, icon: IconComp, title, text }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(event) => {
                if (scrollToHash(id)) {
                  event.preventDefault()
                  history.replaceState(null, '', `#${id}`)
                }
              }}
              className="group flex items-center gap-3 rounded-2xl px-4 py-3.5 ring-1 ring-border transition-colors duration-150 hover:bg-fill hover:no-underline"
            >
              <IconComp size={22} weight="duotone" className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block text-[15px] font-semibold text-foreground">{title}</span>
                <span className="mt-0.5 block text-[13.5px] text-muted-foreground">{text}</span>
              </span>
              <ArrowRightIcon className="text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
          ))}
        </div>
      </DocSection>

      <DocSection id="practice" title="Practise sentences">
        <div className="max-w-[70ch] space-y-4">
          <p>
            <Link to="/practice">Practice</Link> is where you say a sentence and see every word and sound checked.
          </p>
          <Steps
            items={[
              'Pick a level (Beginner, Intermediate or Advanced), or tap “For me” for sentences built around your trouble sounds.',
              'Press “Listen” to hear it first, then tap the orb (or press Space) and say the sentence. Tap again when you’re done.',
              'Read your result: the words a listener would miss, each sound that slipped and what it turned into, and one tip from your coach.',
              'Tap a word for how to make its sounds. Try again (R) or move to the next phrase (N).',
            ]}
          />
          <p>
            <b>Tip:</b> after an attempt you can share it with a teacher (a 7-day link) or ask real listeners whether they understood you.
          </p>
        </div>
      </DocSection>

      <DocSection id="interview" title="Interview prep">
        <div className="max-w-[70ch] space-y-4">
          <p>
            <Link to="/interview">Interview prep</Link> has three ways to practise, each with a spoken interviewer.
          </p>
          <h3>Mock interview</h3>
          <Steps
            items={[
              'Choose the kind of interview (full, HR round, behavioural, role-specific, tough questions, phone screen, university admission or student visa), your role and experience, and 3, 5 or 7 questions.',
              'Choose Real interview (feedback at the end, follow-up questions, like the real thing) or Practice (tips and feedback after every answer).',
              'Alex greets you, asks each question aloud and listens. In a real interview, recording starts as soon as the question ends; press Space when you’ve finished.',
              'Read your report: content scores, the checks you passed, your pace and fillers, and every answer with a clearer version of it.',
            ]}
          />
          <h3>From your CV</h3>
          <p>
            Upload your CV (PDF, Word or text) or paste it, and optionally the job advert. The interviewer asks about your own projects,
            skills and the gaps between your CV and the job. Your CV is never stored.
          </p>
          <h3>Group discussion</h3>
          <p>
            Pick a topic and discuss it with three participants while Alex moderates. Press <Kbd>Space</Kbd> to jump in at any moment; you
            don’t have to wait to be asked. Start the discussion if you can, build on others’ points, and summarise at the end. The report
            shows what assessors look for.
          </p>
        </div>
      </DocSection>

      <DocSection id="speak" title="Speak freely and IELTS">
        <div className="max-w-[70ch] space-y-4">
          <p>
            <Link to="/speak">Speak freely</Link> gives you a question to answer in your own words, for up to two minutes: single interview
            questions, IELTS Speaking Part 2 cue cards (with one minute to prepare), and everyday situations like a phone call or a meeting
            update.
          </p>
          <p>
            You get your pace, long pauses, filler words, the sound slips the coach is sure about and, with the AI coach on, feedback on
            structure.
          </p>
        </div>
      </DocSection>

      <DocSection id="listening" title="Listening and real listeners">
        <div className="max-w-[70ch] space-y-4">
          <p>
            It’s hard to say a sound you can’t hear. In <Link to="/drills?mode=listen">Drills → Listen</Link>, you hear one word of a pair
            (“think” or “sink”) in a different voice each time and pick which one it was.
          </p>
          <p>
            In <Link to="/drills?mode=listeners">Drills → Real listeners</Link>, other learners type what they heard in your shared
            recordings, so you find out what people really understand. You can help them by listening to theirs.
          </p>
        </div>
      </DocSection>

      <DocSection id="coach" title="Your coach">
        <div className="max-w-[70ch] space-y-4">
          <p>
            <Link to="/coach">Coach</Link> picks one sound for today from what you actually do, and walks you through a short session: feel
            the sound, hear it, say some words, then a sentence.
          </p>
          <p>“Talk to your coach” starts a live voice conversation. The coach talks back and helps with words you find hard as you go.</p>
        </div>
      </DocSection>

      <DocSection id="progress" title="Progress and before & after">
        <div className="max-w-[70ch] space-y-4">
          <p>
            <Link to="/progress">Progress</Link> shows your scores over time, your streak, the sounds you have mastered, tricky words and
            your interviews. <Link to="/journey">Journey</Link> sets a daily goal and the path through the sounds.
          </p>
          <p>
            In <Link to="/before-after">Before &amp; after</Link>, record five sentences now and again later, or answer one interview
            question on Day 1 and Day 30, then hear them side by side and make a video to share.
          </p>
        </div>
      </DocSection>

      <DocSection id="settings" title="Settings that help">
        <ul className="max-w-[70ch]">
          <li>
            <b>Your first language</b> puts the sounds that are hard for its speakers first.{' '}
            {tuned.length
              ? `For ${tuned.join(', ')} it also picks a sound model tuned for South Asian speakers of English, so slips like “the” said as “de” are caught; no language gets a bonus or penalty.`
              : 'It never changes a score.'}
          </li>
          <li>
            <b>Help improve Vocaly AI</b>, when you are signed in, gives clean recordings of the app’s practice sentences to train the
            scoring. It is off until you turn it on, and Delete removes what you gave. See the <Link to="/privacy#recordings">Privacy Policy</Link>.
          </li>
          <li>
            <b>Tips in Hindi, Urdu or Hinglish</b> explain how to make each sound in your language.
          </li>
          <li>
            <b>British English</b> accepts British pronunciations and uses a British voice.
          </li>
          <li>
            <b>Natural speed</b> marks slow, careful speech so it doesn’t count toward your goals.
          </li>
          <li>
            <b>Voice and speed</b> choose the coach’s voice and how fast it speaks.
          </li>
        </ul>
        <p className="flex items-center gap-1.5 text-[15px]">
          <GearSixIcon size={18} className="text-subtle" /> Open settings from the gear icon in the app.
        </p>
      </DocSection>

      <DocSection id="shortcuts" title="Keyboard shortcuts">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 overflow-hidden rounded-2xl text-left text-[14px] ring-1 ring-border">
            <thead>
              <tr className="bg-fill">
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Where
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Keys
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  What it does
                </th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map(([where, keys, what]) => (
                <tr key={`${where}-${keys.join('+')}`}>
                  <td className="border-t border-border px-4 py-2.5 text-muted-foreground">{where}</td>
                  <td className="border-t border-border px-4 py-2.5">
                    <span className="flex gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </td>
                  <td className="border-t border-border px-4 py-2.5 text-foreground">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection id="faq" title="Questions">
        {faq.length ? <Accordion items={faq} /> : <p>No questions match “{query}”.</p>}
      </DocSection>

      <DocSection id="troubleshooting" title="Troubleshooting">
        {trouble.length ? <Accordion items={trouble} /> : <p>No fixes match “{query}”.</p>}
        <p className="flex items-center gap-2 pt-2 text-[15px]">
          <UsersThreeIcon size={18} className="text-subtle" />
          Something else? Contact us using the details below.
        </p>
      </DocSection>
    </DocLayout>
  )
}
