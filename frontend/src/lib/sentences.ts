import type { Level } from './types'

export interface Phrase {
  id: string
  text: string
  level: Level
  category: Category
}

export type Category = 'Everyday' | 'Travel' | 'Work' | 'Ideas' | 'Tricky sounds'

export const CATEGORIES: Category[] = ['Everyday', 'Travel', 'Work', 'Ideas', 'Tricky sounds']

export const LEVELS: { id: Level; label: string; description: string }[] = [
  { id: 'beginner', label: 'Beginner', description: 'Short phrases, forgiving scoring' },
  { id: 'intermediate', label: 'Intermediate', description: 'Natural sentences, standard scoring' },
  { id: 'advanced', label: 'Advanced', description: 'Complex vocabulary, strict scoring' },
]

const raw: [Level, Category, string][] = [
  ['beginner', 'Everyday', 'Hello, how are you today?'],
  ['beginner', 'Everyday', 'Today is a beautiful day.'],
  ['beginner', 'Everyday', 'I like to eat apples.'],
  ['beginner', 'Everyday', 'The cat is on the mat.'],
  ['beginner', 'Everyday', 'We go to school every day.'],
  ['beginner', 'Travel', 'Where is the train station?'],
  ['beginner', 'Travel', 'Can I have a cup of coffee?'],
  ['beginner', 'Work', 'Thank you for your help.'],
  ['beginner', 'Work', 'See you at the meeting.'],
  ['beginner', 'Tricky sounds', 'I think this is the third time.'],
  ['beginner', 'Tricky sounds', 'She sells sea shells.'],
  ['beginner', 'Tricky sounds', 'The red rabbit ran away.'],

  ['intermediate', 'Everyday', 'The quick brown fox jumps over the lazy dog.'],
  ['intermediate', 'Everyday', 'Reading books expands your vocabulary and knowledge.'],
  ['intermediate', 'Everyday', 'Exercise regularly to maintain good physical health.'],
  ['intermediate', 'Travel', 'Could you recommend a good restaurant near the hotel?'],
  ['intermediate', 'Travel', 'Traveling abroad helps you understand different cultures.'],
  ['intermediate', 'Work', 'Communication skills are essential in the workplace.'],
  ['intermediate', 'Work', 'Time management improves productivity and reduces stress.'],
  ['intermediate', 'Ideas', 'Technology has transformed our daily lives significantly.'],
  ['intermediate', 'Ideas', 'Practice makes perfect when learning pronunciation.'],
  ['intermediate', 'Tricky sounds', 'Three thin thieves thought about the weather.'],
  ['intermediate', 'Tricky sounds', 'Very well, we will visit the village in winter.'],
  ['intermediate', 'Tricky sounds', 'The world is a lovely place to live.'],

  ['advanced', 'Work', 'We need to strategically align our objectives with market demands.'],
  ['advanced', 'Work', 'The quarterly financial reports indicate substantial growth potential.'],
  ['advanced', 'Work', 'Effective stakeholder engagement requires transparent communication.'],
  ['advanced', 'Work', 'Regulatory compliance ensures adherence to industry standards.'],
  ['advanced', 'Ideas', 'Implementing sustainable practices enhances social responsibility.'],
  ['advanced', 'Ideas', 'Continuous professional development fosters leadership excellence.'],
  ['advanced', 'Ideas', 'Our competitive advantage lies in innovative technological solutions.'],
  ['advanced', 'Travel', 'The itinerary includes several picturesque Mediterranean villages.'],
  ['advanced', 'Everyday', 'Particularly in February, the weather is rather unpredictable.'],
  ['advanced', 'Tricky sounds', 'The sixth sick sheikh thoroughly rethought his strategy.'],
  ['advanced', 'Tricky sounds', 'Rural jurors rarely reverse their earlier verdicts.'],
  ['advanced', 'Tricky sounds', 'Whether the weather is warm or worse, we will walk.'],
]

export const PHRASES: Phrase[] = raw.map(([level, category, text], i) => ({
  id: `${level}-${i}`,
  level,
  category,
  text,
}))

export function phrasesFor(level: Level): Phrase[] {
  return PHRASES.filter((p) => p.level === level)
}
