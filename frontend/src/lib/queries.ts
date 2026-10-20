import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { CoachRequest, HistoryFilters } from './types'
import { useSettings } from '@/store/settings'

export const keys = {
  health: ['health'] as const,
  voices: ['voices'] as const,
  phonemes: ['phonemes'] as const,
  phoneme: (symbol: string) => ['phoneme', symbol] as const,
  pronounce: (text: string, accent = 'american') => ['pronounce', text, accent] as const,
  tutor: (word: string, expected: string, actual: string) => ['tutor', word, expected, actual] as const,
  analytics: (username: string) => ['analytics', username] as const,
  history: (username: string) => ['history', username] as const,
  practice: (username: string) => ['practice', username] as const,
  account: ['account'] as const,
  coachPlan: (username: string, focus?: string | null) => ['coach-plan', username, focus ?? null] as const,
  journey: (username: string) => ['journey', username] as const,
  report: (username: string) => ['coach-report', username] as const,
}

/** The coach voices the server can speak with. Fixed for a deploy, so it is fetched once. */
export function useVoiceCatalog() {
  return useQuery({ queryKey: keys.voices, queryFn: api.voices, staleTime: Infinity, retry: false })
}

/** The profile choices and the sounds each first language puts first. Fixed for a deploy. */
export function useLearnerOptions() {
  return useQuery({ queryKey: ['learner-options'], queryFn: api.learnerOptions, staleTime: Infinity })
}

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: api.health,
    refetchInterval: (query) => (query.state.data?.models_loaded ? 60_000 : 4_000),
    retry: false,
  })
}

export function usePhonemes() {
  return useQuery({ queryKey: keys.phonemes, queryFn: api.phonemes, staleTime: Infinity })
}

export function usePhoneme(symbol: string | null) {
  return useQuery({
    queryKey: keys.phoneme(symbol ?? ''),
    queryFn: () => api.phoneme(symbol!),
    enabled: !!symbol,
    staleTime: Infinity,
  })
}

export function usePronunciation(text: string) {
  const accent = useSettings((s) => s.accent)
  return useQuery({
    queryKey: keys.pronounce(text, accent),
    queryFn: () => api.pronounce(text, accent),
    enabled: text.trim().length > 0,
    staleTime: Infinity,
  })
}

export function useTutorCard(word: string | null, expected: string | null, actual: string | null) {
  return useQuery({
    queryKey: keys.tutor(word ?? '', expected ?? '', actual ?? ''),
    queryFn: () => api.tutorCard(word!, expected!, actual ?? ''),
    enabled: !!word && !!expected,
    staleTime: Infinity,
  })
}

export function useAnalytics(username: string) {
  return useQuery({
    queryKey: keys.analytics(username),
    queryFn: () => api.analytics(username),
    enabled: !!username,
  })
}

export function useHistory(username: string) {
  return useQuery({
    queryKey: keys.history(username),
    queryFn: () => api.history(username),
    enabled: !!username,
  })
}

/** The coach's written note on progress. Refreshed when new attempts change the numbers it is built from. */
export function useProgressReport(username: string, sessions: number, language: string | null = null) {
  return useQuery({
    queryKey: [...keys.report(username), sessions, language],
    queryFn: () => api.coachReport(username, language),
    enabled: !!username && sessions > 0,
    staleTime: 10 * 60_000,
    retry: false,
  })
}

const HISTORY_PAGE = 15

/** Past attempts, newest first, fetched a page at a time with the filters applied on the server. */
export function useHistoryPages(username: string, filters: HistoryFilters) {
  const minScore = filters.band === 'high' ? 85 : undefined
  const maxScore = filters.band === 'low' ? 70 : undefined
  return useInfiniteQuery({
    queryKey: [...keys.history(username), 'pages', filters.band, filters.text.trim().toLowerCase()],
    queryFn: ({ pageParam }) =>
      api.historyPage(username, { offset: pageParam, limit: HISTORY_PAGE, minScore, maxScore, text: filters.text }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.records.length, 0)
      return loaded < last.total && last.records.length > 0 ? loaded : undefined
    },
    enabled: !!username,
    placeholderData: (previous) => previous,
  })
}

/** Goal, level, badges, the path and the review words. Cheap to fetch, so it refreshes whenever the page is shown. */
export function useJourney(username: string, goal: number) {
  return useQuery({
    queryKey: [...keys.journey(username), goal],
    queryFn: () => api.journey(username, goal),
    enabled: !!username,
    staleTime: 15_000,
    retry: false,
  })
}

export function usePracticeDrills(username: string) {
  return useQuery({ queryKey: keys.practice(username), queryFn: () => api.practice(username) })
}

/** Personalised coaching text for one attempt (keyed by its diagnosed slips). */
export function useCoach(request: CoachRequest | null) {
  return useQuery({
    queryKey: ['coach', request],
    queryFn: () => api.coach(request!),
    enabled: !!request,
    staleTime: Infinity,
    retry: false,
  })
}

/** Whether this browser is signed in, and to what. */
export function useAccount() {
  return useQuery({ queryKey: keys.account, queryFn: api.me, staleTime: 60_000, retry: false })
}

/**
 * The coach's plan. It is held steady for the whole session (a plan that
 * reshuffles its focus after each word would be confusing), so it only
 * refreshes when asked to.
 */
export function useCoachPlan(username: string, focus?: string | null) {
  return useQuery({
    queryKey: keys.coachPlan(username, focus),
    queryFn: () => api.coachPlan(username, focus),
    enabled: !!username,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  })
}
