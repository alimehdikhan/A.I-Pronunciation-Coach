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
  /** What the server did about the room: how noisy it was and what was removed. */
  audio_cleanup?: {
    snr_db: number | null
    denoised: boolean
    method: 'rnnoise' | 'spectral' | null
    background_voices: number
  } | null
  speech: {
    duration: number | null
    speaking_time: number | null
    wpm: number | null
    long_pauses: number
    word_count: number
  }
}

/** One coach voice the server offers (`GET /api/voices`). */
export interface VoiceOption {
  id: string
  name: string
  accent: string
  gender: string
  /** "instant" voices render fast; "natural" ones sound best but take a moment on the first play. */
  speed: 'natural' | 'instant'
}

export interface VoiceCatalog {
  engine: string | null
  default: string | null
  voices: VoiceOption[]
}

export interface Health {
  status: 'healthy' | 'loading'
  models_loaded: boolean
  model_size: string
  language: string
  phoneme_backend: string
  tts_ready: boolean
  /** Where accounts and history are kept, and whether they survive a restart. */
  database?: { engine: 'sqlite' | 'postgresql'; persistent: boolean; source?: string }
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
  /** First attempts against the latest ones, once there are enough to compare. */
  improvement?: { attempts: number; first_average: number; recent_average: number; change: number } | null
  /** Attempts per local day for the last twelve weeks, oldest first. */
  daily_activity?: { date: string; count: number }[]
  /** Per sound, weakest first. */
  sound_mastery?: SoundMastery[]
  /** Words that went wrong most often. */
  tricky_words?: { word: string; misses: number }[]
}

export interface ChatTurn {
  role: 'learner' | 'coach'
  text: string
}

export interface ChatReply {
  reply: string
  try_next: string | null
  words: string[]
  source: 'groq' | 'template'
}

export interface PracticeSentences {
  phoneme: string
  label: string
  level: Level
  sentences: { text: string; target_words: string[] }[]
  source: 'groq' | 'template'
}

export interface ProgressReport {
  report: { headline: string; summary: string; wins: string[]; next_steps: string[] } | null
  source: 'groq' | 'template'
}

export interface HistoryFilters {
  /** all, or only the attempts that need work / went well. */
  band: 'all' | 'low' | 'high'
  text: string
}

export interface HistoryPage {
  records: HistoryRecord[]
  total: number
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
  /** The single most useful change to try on the next attempt. */
  one_thing: string | null
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


export type MasteryStatus = 'new' | 'needs_work' | 'getting_there' | 'solid'

export interface SoundMastery {
  phoneme: string
  label: string
  name: string
  attempts: number
  clean: number
  clean_rate: number
  avg_score: number | null
  recent_rate: number
  trend: 'new' | 'improving' | 'steady' | 'slipping'
  status: MasteryStatus
  last_seen: string | null
}

export interface SessionStep {
  kind: 'learn' | 'listen' | 'words' | 'sentence' | 'review'
  title: string
  instruction: string
  steps?: string[]
  pairs?: string[][]
  words?: string[]
  your_words?: string[]
  sentence?: string
}

export interface CoachPlan {
  has_history: boolean
  observations: number
  focus: {
    phoneme: string
    label: string
    name: string
    category: string
    why: 'history' | 'starter' | 'maintenance'
    reason: string
    stats: SoundMastery | null
    placement: string
    steps: string[]
    confused_with: string[]
    why_wrong: string
    minimal_pairs: string[][]
    your_words: string[]
    words: string[]
    sentence: string
  }
  also_work_on: SoundMastery[]
  strengths: SoundMastery[]
  mastery: SoundMastery[]
  session: SessionStep[]
  briefing: { text: string; source: 'groq' | 'template' }
}
