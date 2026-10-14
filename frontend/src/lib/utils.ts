import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { MetricKey, WordStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type Tone = 'good' | 'primary' | 'warn' | 'bad' | 'muted'

export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return 'muted'
  if (score >= 90) return 'good'
  if (score >= 75) return 'primary'
  if (score >= 60) return 'warn'
  return 'bad'
}

export function scoreLabel(score: number): string {
  if (score >= 95) return 'Native-like'
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Great'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Getting there'
  if (score >= 40) return 'Needs work'
  return 'Keep practising'
}

export const toneText: Record<Tone, string> = {
  good: 'text-good',
  primary: 'text-primary',
  warn: 'text-warn',
  bad: 'text-bad',
  muted: 'text-subtle',
}

export const toneColor: Record<Tone, string> = {
  good: 'var(--good)',
  primary: 'var(--primary)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  muted: 'var(--subtle)',
}

export const STATUS_META: Record<WordStatus, { label: string; color: string; soft: string; text: string }> = {
  correct: { label: 'Correct', color: 'var(--good)', soft: 'bg-good-soft', text: 'text-good' },
  unclear: { label: 'Unclear', color: 'var(--warn)', soft: 'bg-warn-soft', text: 'text-warn' },
  mispronounced: { label: 'Mispronounced', color: 'var(--bad)', soft: 'bg-bad-soft', text: 'text-bad' },
  missing: { label: 'Skipped', color: 'var(--subtle)', soft: 'bg-fill-strong', text: 'text-subtle' },
  extra: { label: 'Extra', color: 'var(--extra)', soft: 'bg-extra-soft', text: 'text-extra' },
}

export const METRIC_META: Record<MetricKey, { label: string; hint: string }> = {
  pronunciation: { label: 'Pronunciation', hint: 'How accurately each sound matched the target' },
  fluency: { label: 'Fluency', hint: 'Pace, pauses and extra words' },
  completeness: { label: 'Completeness', hint: 'Share of the phrase you actually said' },
  clarity: { label: 'Clarity', hint: 'How confidently the speech model understood each word' },
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function relativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = (Date.now() - date.getTime()) / 1000
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
