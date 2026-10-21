import { BriefcaseIcon, ChartLineUpIcon, EarIcon, MicrophoneIcon, TranslateIcon, UsersThreeIcon, type Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AtAGlance, Contact, DocLayout, DocSection, REPOSITORY, useOperator } from '@/components/site/DocLayout'
import { cn } from '@/lib/utils'

const UPDATED = '21 October 2026'

/** A plain, readable table of facts; on a phone each row becomes a card. */
function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <>
      {/* On a phone each row becomes a card, so nothing hides off the side of the screen. */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map((row, i) => (
          <div key={i} className="rounded-2xl bg-fill p-4 text-[14.5px] leading-snug">
            <div className="font-semibold text-foreground">{row[0]}</div>
            {row.slice(1).map((cell, j) => (
              <div key={j} className="mt-2.5">
                <div className="text-[12px] font-semibold tracking-[0.02em] text-subtle uppercase">{head[j + 1]}</div>
                <div className="mt-0.5 text-muted-foreground">{cell}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <table className="hidden w-full border-separate border-spacing-0 overflow-hidden rounded-2xl text-left text-[14px] leading-snug ring-1 ring-border sm:table">
        <thead>
          <tr className="bg-fill">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'border-t border-border px-4 py-3 align-top',
                    j === 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const PRIVACY_TOC = [
  { id: 'who', title: 'Who is responsible' },
  { id: 'what', title: 'What we collect, and why' },
  { id: 'recordings', title: 'Your recordings' },
  { id: 'services', title: 'AI and other services' },
  { id: 'legal-bases', title: 'Why we may use it' },
  { id: 'transfers', title: 'Where it is processed' },
  { id: 'cookies', title: 'Cookies and browser storage' },
  { id: 'security', title: 'Security and logs' },
  { id: 'rights', title: 'Your choices and rights' },
  { id: 'children', title: 'Children' },
  { id: 'changes', title: 'Changes to this policy' },
]

export function PrivacyPage() {
  const { name } = useOperator()
  return (
    <DocLayout
      title="Privacy Policy"
      updated={UPDATED}
      toc={PRIVACY_TOC}
      intro="What Vocaly AI keeps about you, why, who else sees it, and how to delete it. Written to be read, not skimmed past."
    >
      <AtAGlance
        items={[
          'Practice recordings are analysed and thrown away. Audio is kept only when you ask, for a feature that needs it or to help improve the scoring.',
          'We never sell your data, show ads or use tracking cookies.',
          'Other learners never see your name. Teachers see an attempt only through a link you create.',
          'You can delete your history, recordings, interviews and account yourself, at any time.',
        ]}
      />

      <DocSection id="who" title="Who is responsible">
        <p>
          {name} runs this copy of Vocaly AI (“the Coach”, “we”) and is responsible for your data. You can reach us at{' '}
          <Contact />.
        </p>
      </DocSection>

      <DocSection id="what" title="What we collect, and why">
        <p>We keep only what a feature needs, and only for as long as it needs it.</p>
        <DataTable
          head={['What', 'Why', 'How long']}
          rows={[
            [
              'Account: email, username, display name, password',
              'To sign you in and keep your progress. The password is stored only as a salted scrypt hash.',
              'Until you delete your account',
            ],
            [
              'Guest profile key',
              'So only your browser can open your history. We keep only a hash of it.',
              'Until you delete your history',
            ],
            [
              'Practice results: the sentence, what was heard (text), scores and sounds',
              'To show your progress and choose what to practise next.',
              'Until you delete your history or account',
            ],
            [
              'Your settings: first language, goal, tip language',
              'To put the right sounds first and write tips. For some first languages it also picks a sound model tuned for their speakers; no language gets a bonus or penalty.',
              'Until you change them or delete your account',
            ],
            [
              'Mock interviews: questions, the text of your answers, feedback',
              'So you can carry on an interview and review it. No audio.',
              'Your newest 50, until you delete them',
            ],
            ['A CV or job advert you add', 'To write the interview questions.', 'Not stored: read once'],
            ['Group discussions', 'To give you a report on the discussion.', 'Not stored: kept in your browser'],
            [
              'Recordings you give to improve the scoring',
              'To train and test the scoring, only while “Help improve Vocaly AI” is on. See Your recordings below.',
              'Until you delete them, your history or your account',
            ],
            [
              '“I think this is wrong” reports',
              'To improve the scoring. The word, the sounds and your reason; no audio.',
              'Until you delete your history or account',
            ],
            ['Teacher comments on an attempt you shared', 'To show you your teacher’s feedback.', 'With the attempt, until you delete it'],
            ['Password reset links', 'To reset your password, where email is set up. Only a hash is kept.', '30 minutes'],
          ]}
        />
      </DocSection>

      <DocSection id="recordings" title="Your recordings">
        <p>
          Recordings you make for practice, interviews and group discussions are analysed in memory and <b>not stored</b>. Audio is kept
          only when you clearly ask for it, in these features:
        </p>
        <ul>
          <li>
            <b>Before &amp; after</b>: your five sentences and your Day 1 vs Day 30 interview answer, so you can hear your progress. Only
            you can play them, and they are kept until you delete them. The Day 1 vs Day 30 video is made on your device and never uploaded.
          </li>
          <li>
            <b>Share with a teacher</b>: one attempt, playable by anyone with the link for 7 days, then deleted (or earlier, when you stop
            the link).
          </li>
          <li>
            <b>Ask real listeners</b>: one practice sentence, played to other signed-in learners for 30 days without your name. You see,
            word by word, how many understood it, never who listened or their exact words. It is deleted after 30 days, when you delete it,
            or if a listener reports it.
          </li>
          <li>
            <b>Help improve Vocaly AI</b> (off unless you turn it on in Settings, and only for signed-in accounts): clean recordings of the
            app’s own practice sentences and words, never text you type yourself, interviews, discussions or conversations. Each is kept
            with the sentence, what was heard, the scores, your first language and the date, filed under a random number instead of your
            name, username or email, in a private Hugging Face dataset that only {name} can open. They are used to train and test the
            scoring, and a person may listen to some of them to mark which sounds were right. They are kept until you delete them (in
            Settings), delete your history or delete your account, and are then removed from the dataset and its history, usually within
            minutes. A scoring model already trained can’t forget a recording, but a deleted one is never used again.
          </li>
        </ul>
        <p>You agree to each of these in the app before anything is stored, and you can withdraw by deleting the recording.</p>
      </DocSection>

      <DocSection id="services" title="AI and other services">
        <ul>
          <li>
            <b>Groq</b> (the AI coach: tips, chat, sentences, interview and discussion feedback, when switched on) receives the practice
            sentence, the detected slips, scores, your first language and tip language, your chat messages, and the text of free-speaking,
            interview and group-discussion answers. For an interview from your CV, it receives the text of your CV, including your name, and
            the job advert, with email addresses, phone numbers and links removed first. It never receives audio or your account email.
          </li>
          <li>
            <b>Google Gemini</b> (only “Talk to your coach” voice conversations) receives your voice and the coach’s replies as they are
            spoken. On Google’s free tier they may be used to improve Google’s products; the app tells you before your first conversation.
            The Coach does not store this audio.
          </li>
          <li>
            <b>Hosting</b>: the app runs on Hugging Face Spaces and the database on Neon, and recordings you give to improve the scoring
            are kept in a private Hugging Face dataset. Where password reset is switched on, an email provider sends the reset email. They
            process data only to run the service.
          </li>
        </ul>
        <p>We do not sell your data, show ads, or use advertising or analytics trackers.</p>
      </DocSection>

      <DocSection id="legal-bases" title="Why we may use it">
        <ul>
          <li>
            <b>To provide the service you asked for</b> (your account, practice results, interviews and settings).
          </li>
          <li>
            <b>Your consent</b>, for stored recordings, teacher links, real listeners, voice conversations and recordings you give to
            improve the scoring. You can withdraw it at any time by deleting the recording or not using the feature.
          </li>
          <li>
            <b>Legitimate interests</b>, to keep the service safe (rate limits, abuse checks) and to improve the scoring from the reports
            you send.
          </li>
        </ul>
      </DocSection>

      <DocSection id="transfers" title="Where it is processed">
        <p>
          The services above may process data outside your country, including in the United States. We use them only for the purposes in
          this policy, and send them only what each feature needs.
        </p>
      </DocSection>

      <DocSection id="cookies" title="Cookies and browser storage">
        <p>
          The Coach sets no cookies of its own and uses no tracking cookies. It uses your browser’s local storage for your settings, your
          profile key, your interview set-up and the phrase you were practising, and session storage for small flags (such as “microphone
          already checked”). Clearing your browser data removes them. The hosting platform may set its own cookies to run the site.
        </p>
      </DocSection>

      <DocSection id="security" title="Security and logs">
        <p>
          Your IP address is used briefly, in memory, to stop abuse (rate limits) and is not stored by the app. Server logs record which
          address was requested (which can include your username), the time and the result, and are kept by the host for a limited time.
          Passwords and links are stored only as hashes, stored recordings can be played only by the people each feature allows, and the
          connection is encrypted. No system is perfectly secure, so please use a password you don’t use anywhere else.
        </p>
      </DocSection>

      <DocSection id="rights" title="Your choices and rights">
        <p>From your Profile and the pages themselves you can:</p>
        <ul>
          <li>delete your practice history (with your interviews, shared recordings, Day 1 vs Day 30 recordings and the recordings you gave to improve the scoring);</li>
          <li>delete stored recordings, a single interview, a recording shared with real listeners, a teacher link, or the recordings you gave (in Settings);</li>
          <li>delete your account, which removes everything above and your sign-ins.</li>
        </ul>
        <p>
          To get a copy of your data, correct it or ask anything about it, contact <Contact />. Depending on where you live (for example
          under India’s Digital Personal Data Protection Act or the EU’s GDPR) you may have further rights, including complaining to a data
          protection authority.
        </p>
      </DocSection>

      <DocSection id="children" title="Children">
        <p>
          The Coach is not meant for children under 13. If you are under 18, please use it with the permission of a parent or guardian,
          especially before storing or sharing recordings.
        </p>
      </DocSection>

      <DocSection id="changes" title="Changes to this policy">
        <p>When this policy changes, the date at the top changes too, and important changes are pointed out in the app.</p>
      </DocSection>
    </DocLayout>
  )
}

const TERMS_TOC = [
  { id: 'acceptance', title: '1. Accepting these terms' },
  { id: 'eligibility', title: '2. Who can use the Coach' },
  { id: 'service', title: '3. What the Coach is, and is not' },
  { id: 'account', title: '4. Your account' },
  { id: 'use', title: '5. Acceptable use' },
  { id: 'content', title: '6. Your content' },
  { id: 'community', title: '7. Sharing with others' },
  { id: 'ai', title: '8. AI features' },
  { id: 'third-parties', title: '9. Other services' },
  { id: 'availability', title: '10. Availability and changes' },
  { id: 'liability', title: '11. Disclaimers and liability' },
  { id: 'ending', title: '12. Ending' },
  { id: 'open-source', title: '13. Open source' },
]

export function TermsPage() {
  const { name } = useOperator()
  return (
    <DocLayout
      title="Terms of Use"
      updated={UPDATED}
      toc={TERMS_TOC}
      intro={
        <>
          The rules for using this hosted copy of Vocaly AI (“the Coach”), run by {name}. They are short, and written in plain English.
        </>
      }
    >
      <AtAGlance
        items={[
          'The Coach is a free practice tool. Its scores and feedback are estimates, not an exam result.',
          'Be kind: no abusive content, and never record other people without their permission.',
          'Your recordings and answers stay yours. We use them only to run the features you choose.',
          'You can stop at any time and delete your account yourself.',
        ]}
      />

      <DocSection id="acceptance" title="1. Accepting these terms">
        <p>
          By using the Coach you agree to these terms and to the <Link to="/privacy">Privacy Policy</Link>. If you don’t agree, please don’t
          use the Coach.
        </p>
      </DocSection>

      <DocSection id="eligibility" title="2. Who can use the Coach">
        <p>
          You must be at least 13. If you are under 18, use the Coach with the permission of a parent or guardian. One account per person,
          please.
        </p>
      </DocSection>

      <DocSection id="service" title="3. What the Coach is, and is not">
        <p>
          The Coach is a practice tool. Its scores, slips, listener estimates, interview and discussion feedback, and tips are produced by
          speech models and, where switched on, a language model. They are <b>estimates that can be wrong</b>. They are not an official
          IELTS or other exam score, not a professional assessment of your English, and no result, job or visa outcome is guaranteed. Use
          your own judgement and, for anything important, a qualified teacher.
        </p>
      </DocSection>

      <DocSection id="account" title="4. Your account">
        <ul>
          <li>Keep your password private. You are responsible for what is done with your account.</li>
          <li>Give an email address you can use; it is how you reset your password where that is available.</li>
          <li>Tell us at once if you think someone else is using your account.</li>
        </ul>
      </DocSection>

      <DocSection id="use" title="5. Acceptable use">
        <p>Please don’t:</p>
        <ul>
          <li>record or upload other people’s voices, or a CV that isn’t yours, without their permission;</li>
          <li>post abusive, hateful, sexual or illegal content, in chat, recordings, topics, comments or answers to other learners;</li>
          <li>try to break, overload, scrape or get around the limits or security of the service;</li>
          <li>use the Coach to impersonate someone, or to mislead others about a score.</li>
        </ul>
        <p>We may limit, suspend or delete accounts, links or recordings that break these rules.</p>
      </DocSection>

      <DocSection id="content" title="6. Your content">
        <p>
          Your recordings, answers, CV and comments remain yours. You allow the Coach to process and store them only as needed to provide
          the features you use, as the Privacy Policy describes. If you turn on “Help improve Vocaly AI”, you also allow the recordings you
          give to be used to train and test the scoring. You can delete them at any time.
        </p>
      </DocSection>

      <DocSection id="community" title="7. Sharing with others">
        <ul>
          <li>
            <b>Teacher links</b>: anyone with the link can play the attempt until it expires, so share it only with people you trust.
            Teachers are responsible for what they write.
          </li>
          <li>
            <b>Real listeners</b>: other learners hear the recording you share, without your name. When you listen to someone else’s, type
            honestly what you heard, and report a recording only when something is wrong with it.
          </li>
        </ul>
      </DocSection>

      <DocSection id="ai" title="8. AI features">
        <ul>
          <li>
            The interviewer (Alex) and the group-discussion participants (Priya, Rahul and Meera) are simulated by software, not real
            people.
          </li>
          <li>
            AI feedback, questions and “clearer versions” of your answers may be wrong or incomplete. Check them before relying on them, and
            never present a clearer version as something you achieved if it isn’t true.
          </li>
          <li>Visa interview practice is not immigration or legal advice. Always answer an officer truthfully.</li>
        </ul>
      </DocSection>

      <DocSection id="third-parties" title="9. Other services">
        <p>
          Some features rely on Groq (AI feedback) and Google Gemini (voice conversations). Their own terms and policies also apply to what
          is sent to them, and those features may be unavailable when the services are.
        </p>
      </DocSection>

      <DocSection id="availability" title="10. Availability and changes">
        <p>
          The Coach is provided free and “as is”. It may be slow, unavailable (for example while its speech models load), changed or stopped
          at any time, and stored data may be lost; keep anything important elsewhere. We may update these terms. The date at the top
          changes when we do, and continuing to use the Coach means you accept the new version.
        </p>
      </DocSection>

      <DocSection id="liability" title="11. Disclaimers and liability">
        <p>
          As far as the law allows, {name} is not liable for indirect or consequential losses, or for decisions you make based on the
          Coach’s feedback, such as exam, job or visa outcomes. Nothing in these terms limits rights you have that cannot be limited by law.
        </p>
      </DocSection>

      <DocSection id="ending" title="12. Ending">
        <p>You can stop at any time and delete your account from your Profile. We may end access for anyone who breaks these terms.</p>
      </DocSection>

      <DocSection id="open-source" title="13. Open source">
        <p>
          The Coach’s code is open source under the MIT licence, on{' '}
          <a href={REPOSITORY} target="_blank" rel="noreferrer">
            GitHub
          </a>
          . These terms cover this hosted service, not the code.
        </p>
      </DocSection>
    </DocLayout>
  )
}

const ABOUT_TOC = [
  { id: 'mission', title: 'Why it exists' },
  { id: 'how', title: 'How it works' },
  { id: 'features', title: 'What you can do' },
  { id: 'accuracy', title: 'How accurate it is' },
  { id: 'people', title: 'Who made it' },
  { id: 'built-with', title: 'Built with' },
  { id: 'contact', title: 'Contact' },
]

const FEATURES: { icon: Icon; title: string; text: string }[] = [
  {
    icon: MicrophoneIcon,
    title: 'Sound-by-sound practice',
    text: 'Read a sentence and see which sounds slipped, what they turned into, and how to fix them.',
  },
  {
    icon: BriefcaseIcon,
    title: 'Interview prep',
    text: 'Mock interviews with a spoken interviewer, interviews from your own CV, and group discussions.',
  },
  {
    icon: EarIcon,
    title: 'Listening drills',
    text: 'Hear word pairs like “think” and “sink” in many voices until your ear knows the difference.',
  },
  {
    icon: UsersThreeIcon,
    title: 'Real listeners',
    text: 'Other learners type what they heard you say, so you know what people really understand.',
  },
  {
    icon: TranslateIcon,
    title: 'Made for your first language',
    text: 'The sounds that are hard for your first language come first, with tips in Hindi or Urdu.',
  },
  {
    icon: ChartLineUpIcon,
    title: 'Progress you can hear',
    text: 'Before and after recordings, Day 1 vs Day 30, streaks and the sounds you have mastered.',
  },
]

export function AboutPage() {
  const { name } = useOperator()
  return (
    <DocLayout
      title="Helping people be understood."
      tabTitle="About"
      toc={ABOUT_TOC}
      wide
      intro="Vocaly AI helps you speak English so that people understand you: in interviews, exams, calls and presentations."
    >
      <DocSection id="mission" title="Why it exists">
        <div className="max-w-[70ch]">
          <p>
            Millions of people know English well and are still asked to repeat themselves. They don’t need more grammar. They need to know
            which sounds get in the way, to hear the difference themselves, and to practise for the moments that matter, like an interview.
            Most tools give a single score. Vocaly AI listens to every sound, says honestly when it isn’t sure, and builds practice around
            you.
          </p>
        </div>
      </DocSection>

      <DocSection id="how" title="How it works">
        <ol className="grid list-none gap-3 pl-0 sm:grid-cols-3 [&>li]:m-0">
          {[
            [
              'Listen',
              'Whisper turns your speech into words. A second model listens to every sound, so it can hear “sink” when you meant “think”.',
            ],
            [
              'Explain',
              'Each slip is marked Fix this when the coach is fairly sure, or Worth checking when it isn’t. You can say a word alone to settle it.',
            ],
            [
              'Train',
              'Drills, listening practice in many voices, a guided coach and interview practice focus on the sounds that matter most for you.',
            ],
          ].map(([title, text], i) => (
            <li key={title} className="rounded-[22px] bg-fill p-5 sm:p-6">
              <div className="text-[12.5px] font-semibold tracking-[0.01em] text-subtle tabular-nums">Step {i + 1}</div>
              <div className="mt-0.5 text-[17px] leading-snug font-semibold text-foreground">{title}</div>
              <p className="mt-1.5 text-[15px] leading-relaxed">{text}</p>
            </li>
          ))}
        </ol>
      </DocSection>

      <DocSection id="features" title="What you can do">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: IconComp, title, text }) => (
            <div key={title} className="rounded-[22px] bg-fill p-5">
              <IconComp size={24} weight="duotone" className="text-primary" />
              <div className="mt-3 text-[16px] leading-snug font-semibold text-foreground">{title}</div>
              <p className="mt-1 text-[14.5px] leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection id="accuracy" title="How accurate it is">
        <div className="max-w-[70ch] space-y-4">
          <p>
            The scores were checked against expert ratings of 5,000 English recordings (speechocean762). On recordings not used for tuning,
            the overall score agrees with the experts at a correlation of about 0.70, and a “Fix this” slip is right a little over half the
            time. That is useful, not perfect: treat every result as a second opinion, and tap “I think this is wrong” when you disagree.
            The full numbers and limits are in the{' '}
            <a href={`${REPOSITORY}#how-well-it-works`} target="_blank" rel="noreferrer">
              project README
            </a>
            .
          </p>
          <p>
            AI feedback on interviews and discussions comes from a language model. It has not been compared with real interviewers or
            assessors, and the app labels it as AI feedback.
          </p>
        </div>
      </DocSection>

      <DocSection id="people" title="Who made it">
        <p>Vocaly AI was developed by Ali Mehdi Khan. This copy is run by {name}. It is open source under the MIT licence.</p>
      </DocSection>

      <DocSection id="built-with" title="Built with">
        <p className="max-w-[70ch]">
          faster-whisper (OpenAI Whisper), wav2vec 2.0 (Meta), Kokoro and Piper voices, the CMU Pronouncing Dictionary, and speechocean762
          (Apache-2.0) for evaluation. Where switched on, Groq and Google Gemini.
        </p>
      </DocSection>

      <DocSection id="contact" title="Contact">
        <p className="max-w-[70ch]">
          Questions, data requests or problems: <Contact />. Please also read the <Link to="/privacy">Privacy Policy</Link> and the{' '}
          <Link to="/terms">Terms of Use</Link>, and see the <Link to="/help">Help centre</Link> for how to use each feature.
        </p>
      </DocSection>
    </DocLayout>
  )
}
