import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { CoachRequest } from './types'

export const keys = {
  health: ['health'] as const,
  phonemes: ['phonemes'] as const,
  phoneme: (symbol: string) => ['phoneme', symbol] as const,
  pronounce: (text: string) => ['pronounce', text] as const,
  tutor: (word: string, expected: string, actual: string) => ['tutor', word, expected, actual] as const,
  analytics: (username: string) => ['analytics', username] as const,
  history: (username: string) => ['history', username] as const,
  practice: (username: string) => ['practice', username] as const,
  account: ['account'] as const,
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
  return useQuery({
    queryKey: keys.pronounce(text),
    queryFn: () => api.pronounce(text),
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
