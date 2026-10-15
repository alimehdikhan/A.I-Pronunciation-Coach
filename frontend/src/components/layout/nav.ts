import {
  BookOpenTextIcon,
  ChalkboardTeacherIcon,
  ChartLineUpIcon,
  MapTrifoldIcon,
  MicrophoneIcon,
  TargetIcon,
  type Icon,
} from '@phosphor-icons/react'

export const NAV: { to: string; label: string; short: string; icon: Icon }[] = [
  { to: '/', label: 'Practice', short: 'Practice', icon: MicrophoneIcon },
  { to: '/journey', label: 'Journey', short: 'Journey', icon: MapTrifoldIcon },
  { to: '/coach', label: 'Coach', short: 'Coach', icon: ChalkboardTeacherIcon },
  { to: '/drills', label: 'Drills', short: 'Drills', icon: TargetIcon },
  { to: '/sounds', label: 'Sound Library', short: 'Sounds', icon: BookOpenTextIcon },
  { to: '/progress', label: 'Progress', short: 'Progress', icon: ChartLineUpIcon },
]
