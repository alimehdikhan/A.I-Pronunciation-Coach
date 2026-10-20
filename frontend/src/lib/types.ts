export type Level = 'beginner' | 'intermediate' | 'advanced'

export type WordStatus = 'correct' | 'unclear' | 'mispronounced' | 'missing' | 'extra'

/** How sure the coach is about a slip: 'fix' is a likely real slip, 'check' a borderline one. */
export type SlipTier = 'fix' | 'check'

export interface AlignmentOp {
  op: 'equal' | 'replace' | 'delete' | 'insert'
  expected: string
  actual: string
  /** Set on slips; missing from results saved before tiers existed (treat as 'fix'). */
  tier?: SlipTier | null
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
  /** The surest slip in the word ('fix' wins over 'check'); null when it has none. */
  tier?: SlipTier | null
  /** A listener would likely not catch this target word: the recogniser heard another word (`heard_as`) or none. */
  misheard?: boolean | null
  heard_as?: string | null
  /** The real word the slip turned this into ("think" said as "sink"). */
  changes_word?: string | null
  /** Would the slip change what a listener understands? false = a minor accent feature. */
  affects_understanding?: boolean | null
  /** Experimental word stress: the dictionary's stressed syllable, the one that sounded stressed, and whether that is a slip. */
  stress?: { expected: number; heard: number; margin: number; error: boolean; prominence: number[] }
  /** Set in the browser after "Say just this word": the borderline slip was real, or it was fine. */
  confirmed?: 'slip' | 'fine'
  /** The verdict replaced the uncertain one in the learner's saved history. */
  confirmedSaved?: boolean
  /** True when the sounds were scored from the audio itself, not just Whisper's words. */
  acoustic?: boolean
  /** Per-sound evidence, one entry per expected sound (acoustic scoring only). */
  phonemes?: PhonemeEvidence[]
}

export interface PhonemeEvidence {
  phoneme: string
  /** 0-100: probability the sound would be rated clean. Most clean sounds score above 90. */
  score: number
  /** The raw goodness of pronunciation (log-posterior, 0 = certainly right) behind `score`. */
  gop?: number | null
  /** True when the sound is reported as a slip. */
  flagged: boolean
  /** For a flagged sound: 'fix' (likely real) or 'check' (borderline). */
  tier?: SlipTier | null
  /** What it most likely was instead ('?' = no standard English sound, '' = dropped). */
  alternative: string | null
  start: number | null
  end: number | null
}

export interface Insight {
  kind: 'substitution' | 'deletion' | 'insertion' | 'word' | 'missing' | 'unclear' | 'extra' | 'pause' | 'pace' | 'praise' | 'stress'
  severity: 'high' | 'medium' | 'low' | 'positive'
  title: string
  word_index: number | null
  expected: string | null
  actual: string | null
  tier?: SlipTier | null
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
  /** "Would a listener understand you?": share of target words a recogniser recovered without being told the target. */
  intelligibility?: { score: number; recovered: number; words: number; estimate: true }
  /** Nothing was heard (silence, muted or wrong microphone). */
  no_speech?: boolean
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
    /** Slower than `careful_below` words per minute: careful, read-aloud speech. */
    careful?: boolean
    careful_below?: number
  }
  /** False when natural-speed mode is on and this was careful speech: shown, but not counted. */
  counted?: boolean
}

/** `POST /api/evaluate/confirm`: how a borderline word came out when said alone. */
export interface ConfirmResult {
  word: string
  /** 'unheard': the word wasn't heard clearly enough to judge; 'unavailable': no sound model on the server. */
  verdict: 'slip' | 'fine' | 'unheard' | 'unavailable'
  sounds: { phoneme: string; verdict: 'slip' | 'fine' | 'unheard'; score: number | null; alternative: string | null }[]
  /** Saved sounds in the original attempt that now carry this verdict. */
  updated: number
  transcription: string
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
  /** The live voice conversation is available. */
  voice_agent?: boolean
  /** Longest answer in Speak freely (seconds). */
  free_speech_seconds?: number
  /** Password reset by email is set up on this server. */
  password_reset?: boolean
  /** Who runs this deployment and how to reach them (Privacy, Terms, About). */
  operator?: string
  contact_email?: string | null
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
  words: { text: string; ipa: string; respelling?: string | null; tokens: WordInfo[] }[]
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
  wpm?: number | null
  /** False: careful speech saved under natural-speed mode, not counted toward mastery or goals. */
  counted?: boolean | null
  created_at: string
  mistakes: { word: string; expected_phoneme: string; actual_phoneme: string }[]
  /** Teachers' comments left through a share link. */
  comments?: { author: string | null; text: string; created_at: string }[]
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
  /** Listening drills: share heard right per contrast, weakest first. */
  perception?: PerceptionStat[]
}

/** How well the learner hears one contrast (e.g. th vs s) in listening drills. */
export interface PerceptionStat {
  phoneme: string
  other: string
  trials: number
  correct: number
  accuracy: number
}

export interface ListenTrial {
  index: number
  phoneme: string
  other: string
  /** The two words of the pair; `answer` is the index of the one that is played. */
  words: [string, string]
  answer: 0 | 1
  word: string
  voice: string
}

export interface ListenSession {
  contrasts: { phoneme: string; other: string; label: string; other_label: string; pairs: string[][] }[]
  trials: ListenTrial[]
  voices: string[]
  note: string | null
  perception: PerceptionStat[]
}

export interface ListenResults {
  saved: number
  session: PerceptionStat[]
  perception: PerceptionStat[]
}

export interface ChatTurn {
  role: 'learner' | 'coach'
  text: string
}

export interface ChatReply {
  reply: string
  try_next: string | null
  words: string[]
  /** Practice sentences, when the learner asked for some. */
  sentences: { text: string; target_words: string[] }[]
  /** `guard` is the built-in respectful reply to abusive messages (no model was called). */
  source: 'groq' | 'template' | 'guard' | 'about'
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

export interface Badge {
  id: string
  title: string
  text: string
  icon: string
  earned: boolean
  have: number
  need: number
}

export interface PathUnit {
  phoneme: string
  label: string
  name: string
  example: string
  status: 'mastered' | 'practising' | 'started' | 'new'
  clean_rate: number | null
  attempts: number
}

export interface Journey {
  goal: { target: number; done: number; met: boolean; progress: number }
  xp: { level: number; xp: number; level_floor: number; next_level_at: number; progress: number }
  streak_days: number
  attempts: number
  best_score: number
  badges: Badge[]
  path: { units: PathUnit[]; current: string | null; mastered: number; total: number }
  review: { word: string; misses: number; tries: number }[]
  checkup_done: boolean
  suggested_level: Level | null
}

export interface CheckupItem {
  text: string
  sounds: string[]
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
  /** 'check' slips get no tip; their words come back in `worth_checking`. */
  tier?: SlipTier | null
  /** false: the slip won't confuse a listener (goal "be clearly understood" lists it as minor). */
  affects?: boolean | null
}

export interface CoachRequest {
  target_text: string
  level: Level
  score: number
  slips: CoachSlip[]
  weak_sounds: { phoneme: string; count: number }[]
  /** The score of the previous attempt at this phrase, when there is one. */
  previous_score?: number | null
  native_language?: string | null
  goal?: 'understood' | 'accent'
  tip_language?: 'English' | 'Hindi' | 'Urdu' | 'Hinglish'
}

export interface CoachReply {
  /** 'groq' when a language model wrote it, 'template' for the built-in tips. */
  source: 'groq' | 'template'
  summary: string
  tips: { word: string; phoneme: string; tip: string }[]
  practice_sentence: string | null
  /** The single most useful change to try on the next attempt. */
  one_thing: string | null
  /** Words whose only slips were borderline: no tip, but worth a second listen. */
  worth_checking?: string[]
  /** Goal "be clearly understood": words whose slips won't confuse a listener. */
  minor?: string[]
  /** The language the tips are in, and a note when it isn't the one asked for. */
  language?: string
  language_note?: string | null
}

export interface SpeakPrompt {
  id: string
  kind: 'interview' | 'ielts' | 'everyday'
  title: string
  hint?: string
  /** IELTS cue cards: what to cover. */
  points?: string[]
}

export interface SpeakPrompts {
  kinds: Record<SpeakPrompt['kind'], { label: string; prep_seconds: number }>
  prompts: SpeakPrompt[]
  max_seconds: number
}

export interface SpeakResult {
  prompt: SpeakPrompt | null
  transcription: string
  no_speech: boolean
  note: string
  max_seconds: number
  delivery: {
    wpm: number | null
    words: number
    duration: number | null
    long_pauses: number
    pause_lengths: number[]
    longest_pause: number | null
    fillers: { count: number; words: string[]; approximate: boolean }
  } | null
  /** Every word of the answer; `reported` marks the sure slips. */
  words: (WordResult & { reported?: boolean })[]
  slips: { index: number; word: string; expected: string; actual: string; changes_word: string | null }[]
  /** Sound accuracy (0-100) when the sound model ran; null otherwise. */
  pronunciation: number | null
  /** One paragraph on clarity and structure, when the language model is available. */
  feedback: { text: string; source: 'groq' | 'template' } | null
}

export interface BaselineTake {
  id: number
  score: number | null
  has_audio: boolean
  created_at: string | null
}

export interface BaselineStatus {
  sentences: string[]
  rounds: { round: number; complete: boolean; finished_at: string | null; average: number | null; sentences: Record<string, BaselineTake> }[]
  /** The round to record next; `due_at` is when a re-recording opens. */
  next: { round: number; due: boolean; due_at: string | null }
  stored_audio: number
}

/** What a teacher sees through a share link. */
export interface SharedAttempt {
  attempt: {
    reference_text: string
    transcription: string
    score: number
    metrics: Record<string, number | null>
    words: { display: string; status: WordStatus; tier: SlipTier | null }[]
    insights: string[]
    wpm: number | null
    created_at: string | null
  }
  expires_at: string
  has_audio: boolean
  comments: { author: string | null; text: string; created_at: string }[]
}

export interface LearnerProfile {
  first_language: string | null
  goal: 'understood' | 'accent'
  tip_language: 'English' | 'Hindi' | 'Urdu' | 'Hinglish'
}

export interface LearnerOptions {
  first_languages: string[]
  goals: { id: 'understood' | 'accent'; label: string; default: boolean }[]
  tip_languages: string[]
  common_sounds: Record<string, string[]>
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
  kind: 'learn' | 'listen' | 'discriminate' | 'words' | 'sentence' | 'review'
  title: string
  instruction: string
  steps?: string[]
  pairs?: string[][]
  words?: string[]
  your_words?: string[]
  sentence?: string
  /** 'discriminate': the sound to train the ear on, how well it is heard so far, and how many trials. */
  phoneme?: string
  accuracy?: number
  trials?: number
}

export interface CoachPlan {
  has_history: boolean
  observations: number
  focus: {
    phoneme: string
    label: string
    name: string
    category: string
    why: 'history' | 'early' | 'starter' | 'maintenance' | 'chosen'
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

/* Mock interviews */

export type InterviewType = 'full' | 'hr' | 'behavioural' | 'technical' | 'tough' | 'phone' | 'university' | 'visa' | 'cv'
export type InterviewKind =
  | 'intro'
  | 'motivation'
  | 'behavioural'
  | 'role'
  | 'strengths'
  | 'logistics'
  | 'tough'
  | 'closing'
  | 'uni_background'
  | 'uni_why'
  | 'uni_goals'
  | 'visa_background'
  | 'visa_study'
  | 'visa_funding'
  | 'visa_plans'
export type FollowUpId = 'example' | 'result' | 'ownership' | 'more'

export interface InterviewQuestion {
  id: string
  /** Position in the interview; answers are keyed by it. */
  index: number | null
  kind: InterviewKind | 'follow_up'
  text: string
  /** What interviewers listen for in an answer to this kind of question. */
  look_for: string
  phrases: string[]
  /** The usual length of a good answer, in seconds. */
  target_seconds: [number, number]
  /** A story question, answered Situation, Task, Action, Result. */
  star: boolean
  follow_up?: FollowUpId
  /** CV interviews: what on the CV or job advert the question is about. */
  about?: string | null
}

/** What was read from a CV and job advert (shown to the learner, never stored). */
export interface CvRead {
  current_role: string
  job_title: string
  projects: string[]
  skills: string[]
  shared_skills: string[]
  missing_skills: string[]
}

export interface InterviewOptions {
  /** `role` and `level`: whether the job role and experience shape this kind of interview. */
  types: { id: InterviewType; label: string; description: string; role: boolean; level: boolean }[]
  roles: { id: string; label: string }[]
  levels: { id: string; label: string }[]
  counts: number[]
  max_seconds: number
}

/** Labels are null when that setting doesn't apply to the interview type (a student visa has no job role). */
export interface InterviewLabels {
  type: InterviewType
  type_label: string
  role: string
  role_label: string | null
  level: string
  level_label: string | null
}

export interface InterviewStart extends InterviewLabels {
  /** Null when the interview isn't saved (no name). */
  id: number | null
  saved: boolean
  questions: InterviewQuestion[]
  max_seconds: number
  /** CV interviews: who wrote the questions, and what was read from the CV. */
  source?: 'groq' | 'template'
  read?: CvRead
}

export interface InterviewCheck {
  id: string
  ok: boolean
  label: string
  /** What to do, when the check failed. */
  fix: string | null
}

export type ContentKey = 'relevance' | 'structure' | 'specificity' | 'clarity'

export interface InterviewRubric {
  scores: Record<ContentKey, number>
  star: { situation: boolean; task: boolean; action: boolean; result: boolean } | null
  strengths: string[]
  improvements: string[]
  /** The candidate's own answer, clearer; [brackets] mark what they still need to add. */
  stronger_answer: string | null
  follow_up?: string | null
  /** What the interviewer says after the answer, showing they listened. */
  reaction?: string | null
  summary: string | null
}

export type InterviewDelivery = NonNullable<SpeakResult['delivery']>

export interface InterviewAnswerResult {
  question: InterviewQuestion
  transcription: string
  no_speech: boolean
  note: string
  max_seconds: number
  delivery: InterviewDelivery | null
  words: (WordResult & { reported?: boolean })[]
  slips: SpeakResult['slips']
  pronunciation: number | null
  checks: InterviewCheck[]
  rubric: InterviewRubric | null
  rubric_source: 'groq' | 'template' | null
  /** What the interviewer would ask next about this answer, if it missed something. */
  follow_up: { id: FollowUpId; text: string } | null
  /** The interviewer's answer to the candidate's own questions at the end. */
  reply: string | null
  saved: boolean
  attempt: number
}

/** What a saved interview keeps of one answer: text and numbers, never audio. */
export interface StoredInterviewAnswer {
  question_id: string
  transcript: string
  delivery: Omit<InterviewDelivery, 'pause_lengths' | 'fillers'> & { fillers: { count: number; words: string[] } }
  checks: InterviewCheck[]
  rubric: InterviewRubric | null
  slips: { word: string; expected: string; actual: string; changes_word: string | null }[]
  pronunciation: number | null
  attempt: number
  answered_at: string
  follow_up?: Omit<StoredInterviewAnswer, 'follow_up'> & { id: FollowUpId; text: string }
}

export interface InterviewReport {
  answered: number
  average_wpm: number | null
  fillers_per_minute: number | null
  long_pauses: number
  content: Record<ContentKey, number> | null
  content_overall: number | null
  checks_passed: number
  checks_total: number
  /** The three things most worth working on, most common first. */
  focus: string[]
  /** Sounds that slipped most often (IPA). */
  sounds: string[]
}

export interface InterviewSummary extends InterviewLabels {
  id: number
  created_at: string
  updated_at: string
  total: number
  answered: number
  finished: boolean
  content_score: number | null
}

export interface InterviewDetail extends InterviewSummary {
  questions: InterviewQuestion[]
  answers: Record<string, StoredInterviewAnswer>
  report: InterviewReport
  max_seconds: number
}

/* Group discussion */

export interface GdTopics {
  topics: { id: string; title: string }[]
  personas: { name: string; voice: string; stance: 'for' | 'against' | 'balanced' }[]
  max_seconds: number
}

/** One turn in the discussion; `you` marks the learner's. */
export interface GdTurn {
  speaker: string
  text: string
  you: boolean
  seconds?: number | null
  /** The learner started talking while someone else was mid-sentence. */
  cut_in?: boolean
  /** The learner's summary at the end. */
  summary?: boolean
  delivery?: InterviewDelivery | null
}

export interface GdContribution {
  text: string
  no_speech: boolean
  delivery: InterviewDelivery | null
  slips: SpeakResult['slips']
}

export type GdKey = 'content' | 'communication' | 'teamwork' | 'leadership'

export interface GdReport {
  topic: { id: string; title: string }
  checks: InterviewCheck[]
  stats: {
    contributions: number
    share: number
    your_seconds: number
    words: number
    average_wpm: number | null
    fillers_per_minute: number | null
    cut_ins: number
  }
  rubric: {
    scores: Record<GdKey, number>
    strengths: string[]
    improvements: string[]
    better_point: string | null
    summary: string | null
  } | null
  rubric_source: 'groq' | 'template' | null
}

/* Real listeners */

export interface ListenerWordResult {
  word: string
  heard: boolean
  /** What was typed in its place, when something was. */
  as: string | null
}

export interface ListenerClipResult {
  id: number
  record_id: number | null
  text: string
  created_at: string | null
  expires_at: string
  active: boolean
  /** A listener reported it; it is no longer played. */
  hidden: boolean
  listeners: number
  /** Share of words real listeners understood (0-100), once someone has listened. */
  understood: number | null
  words: { word: string; heard: number; of: number; heard_as: string[] }[]
  missed: { word: string; heard: number; of: number; heard_as: string[] }[]
}

/* Day 1 vs Day 30 */

export interface Day30Measures {
  wpm: number | null
  duration: number
  words: number
  long_pauses: number
  fillers: number
  fillers_per_minute: number | null
  pronunciation: number | null
  slips: { word: string; expected: string; actual: string }[]
}

export interface Day30Round {
  round: number
  prompt: { id: string; text: string }
  transcript: string
  measures: Day30Measures
  has_audio: boolean
  created_at: string | null
}

export interface Day30Change {
  before: number
  after: number
  delta: number
  /** null when nothing changed. */
  better: boolean | null
}

export interface Day30Status {
  prompts: { id: string; text: string }[]
  max_seconds: number
  every_days: number
  rounds: Day30Round[]
  next: { round: number; due: boolean; due_at: string | null }
  comparison: Partial<Record<'fillers_per_minute' | 'long_pauses' | 'slips' | 'pronunciation' | 'wpm' | 'duration', Day30Change | null>> | null
}
