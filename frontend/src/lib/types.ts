export type Level = 'beginner' | 'intermediate' | 'advanced'

export type WordStatus = 'correct' | 'unclear' | 'mispronounced' | 'missing' | 'extra'

export interface AlignmentOp {
  op: 'equal' | 'replace' | 'delete' | 'insert'
  expected: string
  actual: string
}

export interface Syllable {
  phonemes: string[]
  stress: number
}

export interface WordResult {
  index: number
  reference: string | null
  display: string
  spoken: string | null
  status: WordStatus
  score: number | null
  confidence: number | null
  start: number | null
  end: number | null
  expected_ipa: string
  spoken_ipa: string
  expected_phonemes: string[]
  spoken_phonemes: string[]
  alignment: AlignmentOp[]
  syllables: Syllable[]
  source: 'cmudict' | 'epitran' | 'rules' | 'spelling'
  pause_before: number | null
  /** True when the sounds were scored from the audio itself, not just Whisper's words. */
  acoustic?: boolean
  /** Per-sound evidence, one entry per expected sound (acoustic scoring only). */
  phonemes?: PhonemeEvidence[]
}

export interface PhonemeEvidence {
  phoneme: string
  /** 0-100: probability the sound would be rated clean. Most clean sounds score above 90. */
  score: number
  /** True when the sound is reported as a slip. */
  flagged: boolean
  /** What it most likely was instead ('?' = no standard English sound, '' = dropped). */
  alternative: string | null
  start: number | null
  end: number | null
}

export interface Insight {
  kind: 'substitution' | 'deletion' | 'insertion' | 'word' | 'missing' | 'unclear' | 'extra' | 'pause' | 'pace' | 'praise'
  severity: 'high' | 'medium' | 'low' | 'positive'
  title: string
  word_index: number | null
  expected: string | null
  actual: string | null
}

export interface Metrics {
  pronunciation: number | null
  fluency: number | null
  completeness: number | null
  clarity: number | null
}

export type MetricKey = keyof Metrics

export interface EvaluationResult {
  success: boolean
  transcription: string
  reference_text: string
  record_id: number | null
  saved: boolean
  /** Why the attempt wasn't saved, e.g. 'profile_locked' (name owned by another device). */
  save_error?: string
  score: number
  accuracy: number
  difficulty: Level
  metrics: Metrics
  words: WordResult[]
  insights: Insight[]
  weak_phonemes: string[]
  feedback: string
  speech: {
    duration: number | null
    speaking_time: number | null
    wpm: number | null
    long_pauses: number
    word_count: number
  }
}

export interface Health {
  status: 'healthy' | 'loading'
  models_loaded: boolean
  model_size: string
  language: string
  phoneme_backend: string
  tts_ready: boolean
  /** Sounds are scored from the audio (phoneme model loaded). */
  acoustic_scoring?: boolean
  /** Coaching tips are written by a language model. */
  coach_llm?: boolean
  version: string
}

export interface PhonemeSummary {
  symbol: string
  arpabet: string
  name: string
  label: string
  category: 'consonant' | 'vowel' | 'diphthong'
  group: string
  voiced: boolean
  difficulty: number
  examples: string[]
}

export interface MinimalPair {
  correct: string
  incorrect: string
}

export interface PhonemeDetail extends PhonemeSummary {
  placement: string
  steps: string[]
  common_substitutions: string[]
  why_wrong: string
  minimal_pairs: MinimalPair[]
  practice_sentence: string
}

export interface WordInfo {
  word: string
  ipa: string
  phonemes: string[]
  syllables: Syllable[]
  syllable_count: number
  stress_index: number
  source: string
}

export interface PronounceResponse {
  text: string
  words: { text: string; ipa: string; tokens: WordInfo[] }[]
}

export interface TutorCard {
  word: string
  expected_phoneme: string
  actual_phoneme: string
  phoneme: PhonemeDetail
  actual: { symbol: string; name: string; label: string } | null
  tutor_data: {
    name: string
    label: string
    placement_guide: string
    steps: string[]
    why_wrong: string
    common_substitutions: string[]
    minimal_pairs: MinimalPair[]
    easier_words: string[]
    practice_sentence: string
  }
  syllable_info: WordInfo
}

export interface PracticeDrill {
  target_phoneme: string
  focus: string
  name: string
  category: string
  mistake_count: number | null
  personalized: boolean
  sentence: string
  minimal_pairs: [string, string][]
  examples: string[]
  placement: string
  steps: string[]
}

export interface PracticeResponse {
  username: string
  personalized: boolean
  practices: PracticeDrill[]
}

export interface HistoryRecord {
  id: number
  target_text: string
  transcribed_text: string
  score: number
  accuracy: number
  difficulty: string | null
  pronunciation: number | null
  fluency: number | null
  completeness: number | null
  clarity: number | null
  created_at: string
  mistakes: { word: string; expected_phoneme: string; actual_phoneme: string }[]
}

export interface Analytics {
  average_score: number
  best_score: number
  total_practice_sessions: number
  practice_days: number
  streak_days: number
  sessions_this_week: number
  metric_averages: Partial<Record<MetricKey, number>>
  score_trend: ({ date: string; score: number } & Partial<Record<MetricKey, number | null>>)[]
  top_weaknesses: { phoneme: string; count: number; name: string | null; label: string | null }[]
}

export interface CoachSlip {
  word: string
  kind: 'substitution' | 'deletion' | 'insertion' | 'missing' | 'unclear' | 'extra'
  expected: string
  actual: string
}

export interface CoachRequest {
  target_text: string
  level: Level
  score: number
  slips: CoachSlip[]
  weak_sounds: { phoneme: string; count: number }[]
}

export interface CoachReply {
  /** 'groq' when a language model wrote it, 'template' for the built-in tips. */
  source: 'groq' | 'template'
  summary: string
  tips: { word: string; phoneme: string; tip: string }[]
  practice_sentence: string | null
}

/** The signed-in account for this browser, or `{ account: false }` for a guest. */
export type AccountProfile =
  | { account: false }
  | {
      account: true
      /** Unique handle; history is stored under it. */
      username: string
      /** Shown in the app; several people can share one. */
      display_name: string
      email: string
      /** ISO timestamp. */
      member_since: string | null
      attempts: number
      /** Browsers currently signed in to this account. */
      devices: number
    }
