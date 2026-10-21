import type {
  AccountProfile,
  Analytics,
  CheckupItem,
  ChatReply,
  ChatTurn,
  CoachPlan,
  CoachReply,
  CoachRequest,
  ConfirmResult,
  ContributeStatus,
  Day30Status,
  EvaluationResult,
  BaselineStatus,
  GdContribution,
  GdReport,
  GdTopics,
  GdTurn,
  LearnerOptions,
  SharedAttempt,
  SpeakPrompts,
  SpeakResult,
  LearnerProfile,
  ListenResults,
  ListenSession,
  Health,
  HistoryPage,
  Journey,
  HistoryRecord,
  InterviewAnswerResult,
  InterviewDetail,
  InterviewOptions,
  InterviewStart,
  InterviewSummary,
  ListenerClipResult,
  ListenerWordResult,
  PhonemeDetail,
  PhonemeSummary,
  PracticeResponse,
  PracticeSentences,
  PronounceResponse,
  ProgressReport,
  TutorCard,
  VoiceCatalog,
} from './types'
import { useSettings } from '@/store/settings'
import { prepareRecording } from './audioProcessing'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  readonly status: number
  /** Machine-readable reason, e.g. 'profile_locked' or 'models_loading'. */
  readonly code?: string
  /** Seconds the server asked us to wait (Retry-After), for 429 and 503. */
  readonly retryAfter?: number

  constructor(status: number, message: string, code?: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

/** Proves this browser owns the saved progress for a name. */
function profileHeaders(): Record<string, string> {
  const key = useSettings.getState().profileKey
  return key ? { 'X-Profile-Key': key } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    // Every request says which browser it is from: the app needs a signed-in account.
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...profileHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }
  if (!response.ok) {
    let detail = response.statusText || 'Request failed'
    let code: string | undefined
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* non-JSON error body */
    }
    // Signed out on the server (another device changed the password, the account was deleted):
    // forget the account here too, and the app sends the learner to the sign-in page.
    if (code === 'sign_in_required' && useSettings.getState().accountEmail) useSettings.getState().signOut()
    const wait = Number(response.headers.get('Retry-After'))
    throw new ApiError(response.status, detail, code, Number.isFinite(wait) && wait > 0 ? wait : undefined)
  }
  return response.json() as Promise<T>
}

const enc = encodeURIComponent

export interface EvaluateInput {
  audio: Blob
  filename: string
  text: string
  difficulty: string
  username?: string
  signal?: AbortSignal
}

export const api = {
  health: () => request<Health>('/health'),
  voices: () => request<VoiceCatalog>('/api/voices'),

  evaluate: ({ audio, filename, text, difficulty, username, signal }: EvaluateInput) => {
    const form = new FormData()
    form.append('audio', audio, filename)
    form.append('target_text', text)
    form.append('difficulty', difficulty)
    if (username) form.append('username', username)
    if (useSettings.getState().naturalSpeed) form.append('natural_speed', 'true')
    if (useSettings.getState().stressCheck) form.append('stress', 'true')
    if (useSettings.getState().accent === 'british') form.append('accent', 'british')
    return request<EvaluationResult>('/api/evaluate', {
      method: 'POST',
      body: form,
      signal,
      headers: username ? profileHeaders() : undefined,
    })
  },

  /** Levels the clip (16 kHz WAV), then scores it; returns the audio that was scored. */
  evaluateRecording: async (input: EvaluateInput) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const result = await api.evaluate({ ...input, audio: prepared.blob, filename: prepared.filename })
    return { result, audio: prepared.blob }
  },

  /** Says one "Worth checking" word alone; with `recordId`, the attempt's uncertain sounds take the verdict. */
  confirmWord: async (input: {
    audio: Blob
    filename: string
    word: string
    phonemes: string[]
    recordId?: number | null
    username?: string
  }) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const form = new FormData()
    form.append('audio', prepared.blob, prepared.filename)
    form.append('word', input.word)
    form.append('phonemes', input.phonemes.join(','))
    if (input.recordId != null) form.append('record_id', String(input.recordId))
    if (input.username) form.append('username', input.username)
    return request<ConfirmResult>('/api/evaluate/confirm', {
      method: 'POST',
      body: form,
      headers: input.username ? profileHeaders() : undefined,
    })
  },

  baselineStatus: (username: string) => request<BaselineStatus>(`/api/baseline/${enc(username)}`, { headers: profileHeaders() }),

  /** Scores one before-and-after sentence and stores it (the learner has agreed to store it). */
  baselineRecord: async (username: string, input: { audio: Blob; filename: string; sentenceIndex: number; consent: boolean }) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const form = new FormData()
    form.append('audio', prepared.blob, prepared.filename)
    form.append('sentence_index', String(input.sentenceIndex))
    form.append('consent', input.consent ? 'true' : 'false')
    return request<{ id: number; round: number; score: number | null; transcription: string; status: BaselineStatus }>(
      `/api/baseline/${enc(username)}/record`,
      { method: 'POST', body: form, headers: profileHeaders() },
    )
  },

  /** A stored recording, fetched with the profile key (it is never at a public URL). */
  baselineAudio: async (username: string, id: number): Promise<Blob> => {
    const response = await fetch(`${BASE}/api/baseline/${enc(username)}/audio/${id}`, { headers: profileHeaders() })
    if (!response.ok) throw new ApiError(response.status, 'Could not load that recording.')
    return response.blob()
  },

  deleteBaselineAudio: (username: string) =>
    request<{ deleted: number }>(`/api/baseline/${enc(username)}/audio`, { method: 'DELETE', headers: profileHeaders() }),

  /** Stores one attempt's audio (with consent) behind a 7-day link for a teacher. */
  createShare: (username: string, input: { recordId: number; audio: Blob; analysis: unknown }) => {
    const form = new FormData()
    form.append('audio', input.audio, 'attempt.wav')
    form.append('record_id', String(input.recordId))
    form.append('analysis', JSON.stringify(input.analysis))
    form.append('consent', 'true')
    return request<{ token: string; path: string; expires_at: string; id: number }>(`/api/shares/${enc(username)}`, {
      method: 'POST',
      body: form,
      headers: profileHeaders(),
    })
  },

  listShares: (username: string) =>
    request<{ shares: { id: number; record_id: number; expires_at: string; active: boolean; comments: number }[] }>(
      `/api/shares/${enc(username)}`,
      { headers: profileHeaders() },
    ),

  revokeShare: (username: string, id: number) =>
    request<{ revoked: boolean }>(`/api/shares/${enc(username)}/${id}`, { method: 'DELETE', headers: profileHeaders() }),

  sharedView: (token: string) => request<SharedAttempt>(`/api/shared/${enc(token)}`),

  sharedAudioUrl: (token: string) => `${BASE}/api/shared/${enc(token)}/audio`,

  sharedComment: (token: string, body: { author: string | null; text: string }) =>
    request<{ saved: boolean }>(`/api/shared/${enc(token)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  speakPrompts: () => request<SpeakPrompts>('/api/speak/prompts'),

  /** Scores a free answer (levelled to 16 kHz WAV first). Nothing is saved. */
  speakEvaluate: async (input: { audio: Blob; filename: string; promptId: string | null }) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const form = new FormData()
    form.append('audio', prepared.blob, prepared.filename)
    if (input.promptId) form.append('prompt_id', input.promptId)
    return request<SpeakResult>('/api/speak/evaluate', { method: 'POST', body: form })
  },

  interviewOptions: () => request<InterviewOptions>('/api/interview/options'),

  /** Picks the questions; with a name the interview is saved (text only) after every answer. */
  interviewStart: (body: { type: string; role: string; level: string; count: number; username?: string }) =>
    request<InterviewStart>('/api/interview/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(body.username ? profileHeaders() : {}) },
      body: JSON.stringify(body),
    }),

  /** Questions from the learner's CV (a file or pasted text) and, optionally, the job advert. The CV is never stored. */
  interviewFromCv: (input: { file?: File | null; text?: string; jobAd?: string; level: string; count: number; username?: string }) => {
    const form = new FormData()
    if (input.file) form.append('cv_file', input.file, input.file.name)
    if (input.text?.trim()) form.append('cv_text', input.text)
    if (input.jobAd?.trim()) form.append('job_ad', input.jobAd)
    form.append('level', input.level)
    form.append('count', String(input.count))
    if (input.username) form.append('username', input.username)
    return request<InterviewStart>('/api/interview/cv', {
      method: 'POST',
      body: form,
      headers: input.username ? profileHeaders() : undefined,
    })
  },

  /** Scores one spoken answer (levelled to 16 kHz WAV first); a follow-up answer names its follow-up. */
  interviewAnswer: async (input: {
    audio: Blob
    filename: string
    questionId: string
    /** A CV question in an interview that isn't saved: the server has no copy of it. */
    custom?: { text: string; kind: string }
    type: string
    role: string
    level: string
    sessionId?: number | null
    questionIndex?: number | null
    username?: string
    followUp?: { id: string; text: string } | null
  }) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const form = new FormData()
    form.append('audio', prepared.blob, prepared.filename)
    form.append('question_id', input.questionId)
    form.append('interview_type', input.type)
    form.append('role', input.role)
    form.append('level', input.level)
    const saved = input.sessionId != null && input.questionIndex != null && !!input.username
    if (saved) {
      form.append('session_id', String(input.sessionId))
      form.append('question_index', String(input.questionIndex))
      form.append('username', input.username!)
    }
    if (!saved && input.custom) {
      form.append('question_text', input.custom.text)
      form.append('question_kind', input.custom.kind)
    }
    if (input.followUp) {
      form.append('follow_up', input.followUp.id)
      form.append('follow_up_text', input.followUp.text)
    }
    return request<InterviewAnswerResult>('/api/interview/answer', {
      method: 'POST',
      body: form,
      headers: saved ? profileHeaders() : undefined,
    })
  },

  interviews: (username: string) =>
    request<{ sessions: InterviewSummary[] }>(`/api/interview/sessions/${enc(username)}`, { headers: profileHeaders() }).then(
      (r) => r.sessions,
    ),

  interview: (username: string, id: number) =>
    request<InterviewDetail>(`/api/interview/sessions/${enc(username)}/${id}`, { headers: profileHeaders() }),

  /** A new interview with the same questions as a saved one. */
  repeatInterview: (username: string, id: number) =>
    request<InterviewStart>(`/api/interview/sessions/${enc(username)}/${id}/repeat`, { method: 'POST', headers: profileHeaders() }),

  deleteInterview: (username: string, id: number) =>
    request<{ deleted: boolean }>(`/api/interview/sessions/${enc(username)}/${id}`, { method: 'DELETE', headers: profileHeaders() }),

  gdTopics: () => request<GdTopics>('/api/gd/topics'),

  /** What a participant says next in a group discussion. */
  gdTurn: (body: { topic_id: string; speaker: string; user_name: string; turns: GdTurn[] }) =>
    request<{ speaker: string; text: string; source: 'groq' | 'template' }>('/api/gd/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** One of the learner's contributions, transcribed and measured (levelled to 16 kHz WAV first). Not saved. */
  gdContribution: async (input: { audio: Blob; filename: string }) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const form = new FormData()
    form.append('audio', prepared.blob, prepared.filename)
    return request<GdContribution>('/api/gd/contribution', { method: 'POST', body: form })
  },

  gdReport: (body: { topic_id: string; user_name: string; turns: GdTurn[] }) =>
    request<GdReport>('/api/gd/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** Share one practice recording (with consent) for other learners to hear, anonymously, for 30 days. */
  listenerShare: (username: string, input: { recordId: number; audio: Blob }) => {
    const form = new FormData()
    form.append('audio', input.audio, 'attempt.wav')
    form.append('record_id', String(input.recordId))
    form.append('consent', 'true')
    return request<ListenerClipResult>(`/api/listeners/${enc(username)}/clips`, { method: 'POST', body: form, headers: profileHeaders() })
  },

  listenerClips: (username: string) =>
    request<{ clips: ListenerClipResult[]; helped: number }>(`/api/listeners/${enc(username)}/clips`, { headers: profileHeaders() }),

  listenerDelete: (username: string, id: number) =>
    request<{ deleted: boolean }>(`/api/listeners/${enc(username)}/clips/${id}`, { method: 'DELETE', headers: profileHeaders() }),

  /** Someone else's recording to listen to, or null when there is none right now. */
  listenerNext: (username: string) =>
    request<{ clip: { id: number; words: number } | null; helped: number }>(`/api/listeners/${enc(username)}/next`, {
      headers: profileHeaders(),
    }),

  listenerAudio: async (username: string, id: number): Promise<Blob> => {
    const response = await fetch(`${BASE}/api/listeners/${enc(username)}/audio/${id}`, { headers: profileHeaders() })
    if (!response.ok) throw new ApiError(response.status, 'Could not load that recording.')
    return response.blob()
  },

  listenerAnswer: (username: string, id: number, typed: string) =>
    request<{ text: string; words: ListenerWordResult[]; heard: number; total: number }>(`/api/listeners/${enc(username)}/answer/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify({ typed }),
    }),

  listenerReport: (username: string, id: number) =>
    request<{ reported: boolean }>(`/api/listeners/${enc(username)}/report/${id}`, { method: 'POST', headers: profileHeaders() }),

  day30Status: (username: string) => request<Day30Status>(`/api/day30/${enc(username)}`, { headers: profileHeaders() }),

  /** Records the next Day 1 vs Day 30 round (levelled to 16 kHz WAV first); stored with the learner's consent. */
  day30Record: async (username: string, input: { audio: Blob; filename: string; promptId: string; consent: boolean }) => {
    const prepared = await prepareRecording(input.audio, input.filename)
    const form = new FormData()
    form.append('audio', prepared.blob, prepared.filename)
    form.append('prompt_id', input.promptId)
    form.append('consent', input.consent ? 'true' : 'false')
    return request<Day30Status>(`/api/day30/${enc(username)}/record`, { method: 'POST', body: form, headers: profileHeaders() })
  },

  day30Audio: async (username: string, round: number): Promise<Blob> => {
    const response = await fetch(`${BASE}/api/day30/${enc(username)}/audio/${round}`, { headers: profileHeaders() })
    if (!response.ok) throw new ApiError(response.status, 'Could not load that recording.')
    return response.blob()
  },

  day30Delete: (username: string) =>
    request<{ deleted: number }>(`/api/day30/${enc(username)}`, { method: 'DELETE', headers: profileHeaders() }),

  learnerOptions: () => request<LearnerOptions>('/api/learner/options'),

  /** "Help improve Vocaly AI": whether it is offered, and whether this learner gives recordings. */
  contributeStatus: (username: string) => request<ContributeStatus>(`/api/contribute/${enc(username)}`, { headers: profileHeaders() }),

  setContribute: (username: string, on: boolean) =>
    request<ContributeStatus>(`/api/contribute/${enc(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify({ on }),
    }),

  /** Stop giving recordings and delete every one already given. */
  deleteContributions: (username: string) =>
    request<ContributeStatus>(`/api/contribute/${enc(username)}`, { method: 'DELETE', headers: profileHeaders() }),

  learnerProfile: (username: string) => request<LearnerProfile>(`/api/learner/${enc(username)}`, { headers: profileHeaders() }),

  saveLearnerProfile: (username: string, profile: Partial<LearnerProfile>) =>
    request<LearnerProfile>(`/api/learner/${enc(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(profile),
    }),

  /** A listening drill: one word of a minimal pair per trial, each in a different voice. */
  listenSession: (username: string, { focus, trials }: { focus?: string | null; trials?: number } = {}) => {
    const params = new URLSearchParams()
    if (focus) params.set('focus', focus)
    if (trials) params.set('trials', String(trials))
    return request<ListenSession>(`/api/listen/session/${enc(username || 'guest')}?${params}`, {
      headers: username ? profileHeaders() : undefined,
    })
  },

  listenResults: (username: string, trials: { phoneme: string; other: string; word: string; chosen: string; voice: string }[]) =>
    request<ListenResults>('/api/listen/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(username ? profileHeaders() : {}) },
      body: JSON.stringify({ username, trials }),
    }),

  /** "I think this is wrong" about one flagged sound in a saved attempt. No audio is sent. */
  dispute: (body: {
    username: string
    record_id: number
    word: string
    expected: string
    detected: string
    gop: number | null
    reason: 'said_correctly' | 'accent_normal' | null
  }) =>
    request<{ saved: boolean; id: number }>('/api/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(body),
    }),

    // `v` names the response shape: a cached copy from before the plain-letter respelling is never reused.
  pronounce: (text: string, accent: 'american' | 'british' = 'american') =>
    request<PronounceResponse>(`/api/pronounce?text=${enc(text)}&v=2${accent === 'british' ? '&accent=british' : ''}`),

  phonemes: () => request<{ phonemes: PhonemeSummary[] }>('/api/phonemes').then((r) => r.phonemes),

  phoneme: (symbol: string) => request<PhonemeDetail>(`/api/phonemes/${enc(symbol)}`),

  tutorCard: (word: string, expected: string, actual: string) =>
    request<TutorCard>(`/api/tutor/card?word=${enc(word)}&expected=${enc(expected)}&actual=${enc(actual)}`),

  history: (username: string, limit = 50) =>
    request<{ username: string; records: HistoryRecord[] }>(`/api/history/${enc(username)}?limit=${limit}`, {
      headers: profileHeaders(),
    }).then(
      (r) => r.records,
    ),

  historyPage: (
    username: string,
    { offset = 0, limit = 20, minScore, maxScore, text }: { offset?: number; limit?: number; minScore?: number; maxScore?: number; text?: string },
  ) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (minScore !== undefined) params.set('min_score', String(minScore))
    if (maxScore !== undefined) params.set('max_score', String(maxScore))
    if (text?.trim()) params.set('q', text.trim())
    return request<HistoryPage>(`/api/history/${enc(username)}?${params}`, { headers: profileHeaders() })
  },

  analytics: (username: string) =>
    request<Analytics>(`/api/analytics/${enc(username)}?tz_offset=${new Date().getTimezoneOffset()}`, {
      headers: profileHeaders(),
    }),

  practice: (username: string) =>
    request<PracticeResponse>(`/api/tutor/personalized-practice/${enc(username || 'guest')}`, {
      headers: username ? profileHeaders() : undefined,
    }),

  coach: (body: CoachRequest) =>
    request<CoachReply>('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  coachChat: (body: { username: string; message: string; history: ChatTurn[]; native_language?: string | null }) =>
    request<ChatReply>('/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(body),
    }),

  coachSentences: (body: {
    username: string
    phoneme?: string | null
    level: string
    topic?: string
    count?: number
    native_language?: string | null
  }) =>
    request<PracticeSentences>('/api/coach/practice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(body),
    }),

  coachReport: (username: string, language?: string | null) =>
    request<ProgressReport>(
      `/api/coach/report/${enc(username)}?tz_offset=${new Date().getTimezoneOffset()}${language ? `&language=${enc(language)}` : ''}`,
      {
        headers: profileHeaders(),
      },
    ),

  coachPlan: (username: string, focus?: string | null) =>
    request<CoachPlan>(`/api/coach/plan/${enc(username)}${focus ? `?focus=${enc(focus)}` : ''}`, { headers: profileHeaders() }),

  journey: (username: string, goal: number) =>
    request<Journey>(`/api/journey/${enc(username)}?goal=${goal}&tz_offset=${new Date().getTimezoneOffset()}`, {
      headers: profileHeaders(),
    }),

  checkup: () => request<{ items: CheckupItem[] }>('/api/journey/placement'),

  me: () => request<AccountProfile>('/api/auth/me', { headers: profileHeaders() }),

  register: (input: { email: string; password: string; username: string; display_name?: string }) =>
    request<Extract<AccountProfile, { account: true }>>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(input),
    }),

  /** `identifier` is an email address or a username. */
  login: (input: { identifier: string; password: string }) =>
    request<Extract<AccountProfile, { account: true }>>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(input),
    }),

  available: (username: string) =>
    request<{ available: boolean; reason: string | null }>(`/api/auth/available?username=${enc(username)}`),

  logout: () => request<{ signed_out: boolean }>('/api/auth/logout', { method: 'POST', headers: profileHeaders() }),
  /** Back from Google: trade the one-time pass for signing this browser in. */
  googleFinish: (ticket: string) =>
    request<AccountProfile>('/api/auth/google/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    }),
  /** Google's sign-in address for this browser; Google sends it back to /login, signed in. */
  googleStart: (next: string) =>
    request<{ url: string }>('/api/auth/google/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next }),
    }),

  rename: (changes: { username?: string; display_name?: string }) =>
    request<Extract<AccountProfile, { account: true }>>('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(changes),
    }),

  changePassword: (input: { current_password: string; new_password: string }) =>
    request<Extract<AccountProfile, { account: true }>>('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify(input),
    }),

  deleteAccount: (password: string) =>
    request<{ deleted: boolean }>('/api/auth/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...profileHeaders() },
      body: JSON.stringify({ password }),
    }),

  forgotPassword: (email: string) =>
    request<{ sent: boolean; detail: string }>('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ reset: boolean }>('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }),

  resetHistory: (username: string) =>
    request<{ deleted: number }>(`/api/history/${enc(username)}`, { method: 'DELETE', headers: profileHeaders() }),
}
