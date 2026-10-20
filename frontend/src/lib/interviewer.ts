import type { InterviewType } from './types'

/** The person asking the questions. A neutral name; the voice is the learner's coach voice. */
export const INTERVIEWER = { name: 'Alex' }

/** How each role is said aloud ("for a sales and marketing role"). */
const SPOKEN_ROLE: Record<string, string> = {
  software: 'a software and IT role',
  customer: 'a customer service role',
  sales: 'a sales and marketing role',
  finance: 'a finance and accounting role',
  healthcare: 'a healthcare role',
  teaching: 'a teaching role',
  operations: 'an operations role',
}

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const spoken = (n: number) => NUMBERS[n] ?? String(n)

interface Plan {
  type: InterviewType
  role: string
  count: number
  /** CV interviews: the job from the advert, when one was given. */
  jobTitle?: string
}

/** What happens next, in the interviewer's words. */
function planLine({ type, role, count, jobTitle }: Plan): string {
  const questions = `${spoken(count)} question${count === 1 ? '' : 's'}`
  switch (type) {
    case 'cv': {
      const job = jobTitle ? ` and the job description for the ${jobTitle} role` : ''
      return `I've read your CV${job}, so I'll ask about your own experience. I have ${questions}. Take your time, and answer as you would in the real interview.`
    }
    case 'visa':
      return `I'm going to ask you ${questions} about your study plans. Please answer clearly and honestly.`
    case 'university':
      return `Thank you for your interest in the programme. I'd like to ask you ${questions} about your studies and your goals.`
    case 'phone':
      return `This won't take long: I have ${questions} for you.`
    default: {
      const forRole = SPOKEN_ROLE[role] ? ` for ${SPOKEN_ROLE[role]}` : ''
      return `I'll be interviewing you${forRole}. I have ${questions}. Take your time, and answer as you would in a real interview.`
    }
  }
}

/** What the interviewer says before the first question, when there is no small talk. */
export function openingLine({ name, ...plan }: Plan & { name: string }): string {
  const hello = name ? `Hi ${name}` : 'Hi'
  if (plan.type === 'visa') return `${hello}, please have a seat. ${planLine(plan)}`
  if (plan.type === 'phone') return `${hello}, this is ${INTERVIEWER.name}. Thanks for taking my call. ${planLine(plan)}`
  return `${hello}, thanks for coming in today. I'm ${INTERVIEWER.name}. ${planLine(plan)}`
}

/** A real interview starts with a little small talk (a visa officer skips it). */
export function smallTalkLine({ name, type }: { name: string; type: InterviewType }): string | null {
  const hello = name ? `Hi ${name}` : 'Hi'
  if (type === 'visa') return null
  if (type === 'phone') return `${hello}, this is ${INTERVIEWER.name}. Thanks for taking my call. Is now still a good time to talk?`
  return `${hello}, I'm ${INTERVIEWER.name}. Thanks for coming in today. How are you doing?`
}

/** After the small talk: what happens next. The first question follows. */
export const afterSmallTalkLine = (plan: Plan) => `Thank you. ${planLine(plan)}`

/** When an answer runs far too long, an interviewer cuts in politely. */
export const cutInLine = (type: InterviewType) =>
  type === 'visa' ? 'Thank you, that’s enough on that.' : 'Sorry to stop you there. In the interest of time, let’s move on.'

/** The first question, after the opening. */
export const firstQuestionLine = (question: string) => `Let's start. ${question}`

/** When the learner comes back to an interview they left. */
export const resumeLine = (question: string) => `Welcome back. Let's carry on. ${question}`

const ACKNOWLEDGEMENTS = ['Thank you.', 'Okay, thanks.', 'Great, thank you.', 'Got it, thanks.', 'Thanks for that.', 'Alright, thank you.']

/**
 * A short acknowledgement, then the next question; the last one is announced, as interviewers do.
 * `lead` replaces the stock thanks: the interviewer's reaction to the answer, or a polite cut-in.
 */
export function nextQuestionLine(index: number, total: number, question: string, lead?: string | null): string {
  const thanks = lead || ACKNOWLEDGEMENTS[(index - 1) % ACKNOWLEDGEMENTS.length]
  return `${thanks} ${index === total - 1 ? 'My last question. ' : ''}${question}`
}

export function closingLine(type: InterviewType): string {
  if (type === 'visa') return "Thank you. That's everything I need to ask you."
  if (type === 'phone') return "That's all from me. Thanks for your time today, and we'll be in touch."
  return "That's all my questions. Thank you for your time today."
}

export const RETRY_LINE = "Sorry, I didn't catch that. Could you say that again?"

/** Placeholders in the clearer answer ("[result with a number]") are read as a pause, not as words. */
export const speakable = (text: string) => text.replace(/\s*\[[^\]]*\]\s*/g, ', … ')
