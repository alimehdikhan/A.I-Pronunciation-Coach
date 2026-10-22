import {
  BriefcaseIcon,
  ChartLineUpIcon,
  ChatTeardropDotsIcon,
  MapTrifoldIcon,
  MicrophoneIcon,
  SparkleIcon,
  TargetIcon,
  WaveformIcon,
  type Icon,
  type IconWeight,
} from '@phosphor-icons/react'

export interface NavItem {
  to: string
  label: string
  short: string
  icon: Icon
  /** The colour of the item's app-style tile in the sidebar and search. */
  tile: string
  /** The symbol's weight on the tile; filled unless the filled shape reads as a box. */
  glyph?: IconWeight
}

export const NAV: NavItem[] = [
  { to: '/practice', label: 'Practice', short: 'Practice', icon: MicrophoneIcon, tile: 'bg-gradient-to-b from-[#4fa3ff] to-[#0a6cff]' },
  { to: '/interview', label: 'Interview prep', short: 'Interview', icon: BriefcaseIcon, tile: 'bg-gradient-to-b from-[#8c8dff] to-[#5856d6]' },
  { to: '/speak', label: 'Speak freely', short: 'Speak', icon: ChatTeardropDotsIcon, tile: 'bg-gradient-to-b from-[#5fe08a] to-[#22a95a]' },
  { to: '/journey', label: 'Journey', short: 'Journey', icon: MapTrifoldIcon, tile: 'bg-gradient-to-b from-[#ffb340] to-[#ff8a00]' },
  { to: '/coach', label: 'Coach', short: 'Coach', icon: SparkleIcon, tile: 'bg-ai' },
  { to: '/drills', label: 'Drills', short: 'Drills', icon: TargetIcon, tile: 'bg-gradient-to-b from-[#ff7a70] to-[#ff3b30]' },
  { to: '/sounds', label: 'Sound Library', short: 'Sounds', icon: WaveformIcon, tile: 'bg-gradient-to-b from-[#4fe0d0] to-[#13a89e]', glyph: 'bold' },
  { to: '/progress', label: 'Progress', short: 'Progress', icon: ChartLineUpIcon, tile: 'bg-gradient-to-b from-[#d07ff0] to-[#af52de]', glyph: 'bold' },
]
