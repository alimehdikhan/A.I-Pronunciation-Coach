import type {
  AccountProfile,
  Analytics,
  CoachPlan,
  CoachReply,
  CoachRequest,
  EvaluationResult,
  Health,
  HistoryRecord,
  PhonemeDetail,
  PhonemeSummary,
  PracticeResponse,
  PronounceResponse,
  TutorCard,
} from './types'
import { useSettings } from '@/store/settings'
import { prepareRecording } from './audioProcessing'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  readonly status: number
  /** Machine-readable reason, e.g. 'profile_locked'. */
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
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
    response = await fetch(`${BASE}${path}`, init)
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
    throw new ApiError(response.status, detail, code)
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

  evaluate: ({ audio, filename, text, difficulty, username, signal }: EvaluateInput) => {
    const form = new FormData()
    form.append('audio', audio, filename)
    form.append('target_text', text)
    form.append('difficulty', difficulty)
    if (username) form.append('username', username)
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

  pronounce: (text: string) => request<PronounceResponse>(`/api/pronounce?text=${enc(text)}`),

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

  coachPlan: (username: string) =>
    request<CoachPlan>(`/api/coach/plan/${enc(username)}`, { headers: profileHeaders() }),

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

  resetHistory: (username: string) =>
    request<{ deleted: number }>(`/api/history/${enc(username)}`, { method: 'DELETE', headers: profileHeaders() }),
}
