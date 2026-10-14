import { lazy, Suspense } from 'react'
import type { SiriOrbProps } from './SiriOrb'

const SiriOrb = lazy(() => import('./SiriOrb').then((m) => ({ default: m.SiriOrb })))

/** Loads Three.js on demand; a quiet glass placeholder holds the space meanwhile. */
export function LazySiriOrb(props: SiriOrbProps) {
  const size = props.size ?? 240
  const dimension = typeof size === 'number' ? `${size}px` : size
  return (
    <Suspense
      fallback={
        <div
          aria-hidden
          className={props.className}
          style={{
            width: dimension,
            height: dimension,
            borderRadius: '50%',
            boxShadow: 'inset 0 0 0 1px rgb(140 150 170 / 0.28), inset 0 -12px 30px -12px rgb(140 160 220 / 0.25)',
          }}
        />
      }
    >
      <SiriOrb {...props} />
    </Suspense>
  )
}
