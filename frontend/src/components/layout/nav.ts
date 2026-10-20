import {
  BookOpenTextIcon,
  BriefcaseIcon,
  ChalkboardTeacherIcon,
  ChartLineUpIcon,
  ChatsCircleIcon,
  MapTrifoldIcon,
  MicrophoneIcon,
  TargetIcon,
  type Icon,
} from '@phosphor-icons/react'

export const NAV: { to: string; label: string; short: string; icon: Icon }[] = [
  { to: '/practice', label: 'Practice', short: 'Practice', icon: MicrophoneIcon },
  { to: '/interview', label: 'Interview prep', short: 'Interview', icon: BriefcaseIcon },
  { to: '/speak', label: 'Speak freely', short: 'Speak', icon: ChatsCircleIcon },
  { to: '/journey', label: 'Journey', short: 'Journey', icon: MapTrifoldIcon },
  { to: '/coach', label: 'Coach', short: 'Coach', icon: ChalkboardTeacherIcon },
  { to: '/drills', label: 'Drills', short: 'Drills', icon: TargetIcon },
  { to: '/sounds', label: 'Sound Library', short: 'Sounds', icon: BookOpenTextIcon },
  { to: '/progress', label: 'Progress', short: 'Progress', icon: ChartLineUpIcon },
]
