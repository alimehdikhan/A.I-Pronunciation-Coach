import type { InterviewType } from './types'

/** The person asking the questions. A neutral name; the voice is the learner's coach voice. */
export const INTERVIEWER = { name: 'Alex' }

/** The team the interviewer hires for, when the learner gave no job title. */
const TEAM: Record<string, string> = {
  software: 'engineering',
  customer: 'customer support',
  sales: 'sales',
  finance: 'finance',
  healthcare: 'clinical',
  teaching: 'teaching',
  operations: 'operations',
}

interface Plan {
  type: InterviewType
  role: string
  count: number
  /** The job the learner is preparing for, when given (or the job advert's title, for a CV interview). */
  jobTitle?: string | null
  company?: string | null
  /** The interview ends with the candidate's own questions. */
  closing?: boolean
}

const at = (company?: string | null) => (company ? ` at ${company}` : '')

/**
 * Who the interviewer is and what the conversation covers, said the way a real interviewer says it:
 * no question counts and no "answer as you would in a real interview".
 */
function introLine({ type, role, count, jobTitle, company, closing }: Plan): string {
  const questionsAtEnd = closing ? ', and there will be time for your questions at the end' : ''
  switch (type) {
    case 'cv':
      return `I've had a look at your CV${jobTitle ? ` and the ${jobTitle} role` : ''}, so I'd like to hear more about your experience${questionsAtEnd}.`
    case 'visa':
      return ''
    case 'university':
      return "I'd like to hear about you, why this programme, and what you hope to do after it."
    case 'phone':
      return `${jobTitle ? `It's about the ${jobTitle} role${at(company)}. ` : ''}This should take ${count <= 3 ? 'about ten minutes' : 'fifteen minutes or so'}. I'd like to hear a bit about you and what you're looking for.`
    default: {
      const job = jobTitle ? `the ${jobTitle} role` : TEAM[role] ? `this role on the ${TEAM[role]} team` : 'this role'
      return `I'm the hiring manager for ${job}${at(company)}. I'd like to get to know you and hear about your experience${questionsAtEnd}.`
    }
  }
}

/** What the interviewer says before the first question, when there is no small talk. */
export function openingLine({ name, ...plan }: Plan & { name: string }): string {
  const hello = name ? `Hi ${name}` : 'Hi'
  if (plan.type === 'visa') return 'Good morning. May I see your passport, please? Thank you.'
  if (plan.type === 'phone') return `${hello}, this is ${INTERVIEWER.name}${plan.company ? ` from ${plan.company}` : ''}. Thanks for taking my call. ${introLine(plan)}`
  return `${hello}, thanks for coming in today. I'm ${INTERVIEWER.name}. ${introLine(plan)}`
}

/** A real interview starts with a little small talk (a visa officer skips it). */
export function smallTalkLine({ name, type, company }: { name: string; type: InterviewType; company?: string | null }): string | null {
  const hello = name ? `Hi ${name}` : 'Hi'
  if (type === 'visa') return null
  if (type === 'phone')
    return `${hello}, this is ${INTERVIEWER.name}${company ? ` from ${company}` : ''}. Thanks for taking my call. Is now still a good time to talk?`
  return `${hello}, I'm ${INTERVIEWER.name}. Thanks for coming in today. How are you doing?`
}

/** How the candidate answered the greeting, as the server heard it (backend/interview.py SMALL_TALK_MOODS). */
export type SmallTalkMood = 'good_and_asked' | 'asked_back' | 'good' | 'nervous' | 'not_great' | 'busy' | 'other'

const SMALL_TALK_REPLIES: Record<SmallTalkMood, string> = {
  good_and_asked: "Glad to hear it. I'm doing well, thanks for asking.",
  asked_back: "I'm doing well, thanks for asking.",
  good: 'Good to hear.',
  nervous: "That's completely normal. Just take your time.",
  not_great: 'Sorry to hear that. Thanks for making the time today.',
  busy: "I'll keep it brief, then.",
  other: 'Okay, great.',
}

/** The interviewer's answer to the candidate's small talk (a phone screen asked whether now is a good time). */
export function smallTalkReply(mood: SmallTalkMood | null | undefined, type: InterviewType): string | null {
  if (!mood) return null
  if (type === 'phone' && mood === 'good') return 'Great, thanks.'
  return SMALL_TALK_REPLIES[mood]
}

/** Every small-talk reply, rendered before the interview starts so the answer comes at once. */
export const smallTalkReplies = (type: InterviewType) =>
  [...new Set((Object.keys(SMALL_TALK_REPLIES) as SmallTalkMood[]).map((mood) => smallTalkReply(mood, type)!))]

/** After the small talk: who the interviewer is and what comes next. The first question follows. */
export const afterSmallTalkLine = (plan: Plan) => `Alright. ${introLine(plan)}`

/** When an answer runs far too long, an interviewer cuts in politely. */
export const cutInLine = (type: InterviewType) =>
  type === 'visa' ? 'Thank you, that’s enough on that.' : 'Sorry to stop you there. In the interest of time, let’s move on.'

/** The first question, after the opening. A visa officer simply asks. */
export const firstQuestionLine = (question: string, type?: InterviewType) => (type === 'visa' ? question : `So, let's start. ${question}`)

/** When the learner comes back to an interview they left. */
export const resumeLine = (question: string) => `Welcome back. Let's pick up where we left off. ${question}`

const BACKCHANNELS = ['Okay.', 'Right.', 'I see.', 'Got it.', 'Okay, thanks.', 'Alright.']

/**
 * What the interviewer says the moment an answer ends, as people do, while they decide what to say next.
 * Rendered before the interview starts, so it plays at once. A visa officer just says "Okay."
 */
export const backchannel = (n: number, type?: InterviewType) => (type === 'visa' ? 'Okay.' : BACKCHANNELS[n % BACKCHANNELS.length])
export const backchannels = (type?: InterviewType) => (type === 'visa' ? ['Okay.'] : BACKCHANNELS)

const ACKNOWLEDGEMENTS = ['Okay, thank you.', 'Thanks.', 'Got it.', 'Alright, thanks.', 'I see. Thank you.', 'Okay.']

/** What the interviewer says after an answer when it has nothing more specific to say. Neutral, never a verdict. */
export const acknowledgement = (index: number, type?: InterviewType) =>
  type === 'visa' ? 'Okay.' : ACKNOWLEDGEMENTS[(index - 1 + ACKNOWLEDGEMENTS.length) % ACKNOWLEDGEMENTS.length]

/** The next question; the last one is announced, as interviewers do. Said after the acknowledgement. */
export function nextQuestionLine(index: number, total: number, question: string): string {
  return `${index === total - 1 && total > 2 ? 'One last question. ' : ''}${question}`
}

export function closingLine(type: InterviewType): string {
  if (type === 'visa') return "Okay. That's all I need from you today. Thank you."
  if (type === 'phone') return "That's all from me. Thanks for your time. I'll pass this on, and we'll be in touch about next steps."
  if (type === 'university') return "That's everything from me. Thank you, it was good to hear about your plans. You'll hear from us soon."
  return "That's everything from me. Thanks for your time today, it was good to talk to you. We'll be in touch within the week."
}

export const RETRY_LINE = "Sorry, I didn't catch that. Could you say that again?"

/** Placeholders in the clearer answer ("[result with a number]") are read as a pause, not as words. */
export const speakable = (text: string) => text.replace(/\s*\[[^\]]*\]\s*/g, ', … ')

/** The question id for the reply to the greeting (backend/interview.py SMALL_TALK_ID). */
export const SMALL_TALK_ID = 'small-talk'
