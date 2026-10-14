# SiriOrb

A Siri-inspired glass orb rendered with Three.js and custom GLSL shaders, modelled on the new Siri.

Inside a clear glass bubble with a dispersive, rainbow-edged rim, ribbons of white light twist like silk and split into prismatic fringes. It behaves like the iOS 27 orb: it pulses and follows the voice while listening, settles into a "thinking" state with a loading comet, and blooms with halation while speaking.

The component visualises audio only; recording, playback and speech are handled by the host app.

- Optical glass shading: Fresnel rim, curvature, specular and sky reflections, and lensing of the internal light
- Light mode: clear crystal glass with silver edges and cool reflections, so it never reads as a black disc on white
- Dark mode: smoked glass with luminous colour
- Theme changes cross-fade on the GPU
- Transparent canvas (no backdrop), DPR-aware, and a perfect circular silhouette anti-aliased in the shader
- Pauses off-screen and in background tabs, respects `prefers-reduced-motion`, and releases its WebGL context on unmount

**Files:** `SiriOrb.tsx` (component), `shaders.ts` (GLSL), `LazySiriOrb.tsx` (optional code-split wrapper)
**Dependency:** `three`

## Props

| Prop | Type | Default | |
|---|---|---|---|
| `size` | `number \| string` | `240` | Sphere diameter: px or any CSS length (`"min(60vw, 320px)"`). The glow extends past it without affecting layout. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `auto` follows `.dark` / `.light` classes or `data-theme` on `<html>`, falling back to the OS preference. |
| `state` | `'idle' \| 'listening' \| 'thinking' \| 'speaking'` | `'idle'` | `idle` breathes on its own. `listening` pulses and follows input; soft rings ripple out as it wakes. `thinking` settles the ribbons while a comet circles the rim. `speaking` follows playback with extra brightness and halation. |
| `audioLevel` | `number` | `0` | Normalised intensity, 0–1. |
| `frequencyBands` | `ArrayLike<number>` | – | Any number of magnitudes (0–1, or 0–255 from `getByteFrequencyData`), reduced to 4 bands. |
| `getAudioFrame` | `() => { level, bands? } \| null` | – | Polled every frame, so React doesn't re-render. Takes priority over props. |
| `glowIntensity` | `number` | `1` | Outer glow, 0 to about 2. |
| `className`, `style` | | | Applied to the wrapper. |
| `label` | `string` | – | Accessible label. When omitted, the orb is decorative (`aria-hidden`). |

Imperative handle: `ref.current.setAudio(level, bands?)`, for event-driven sources.

## Integration (Next.js / React)

```tsx
'use client'
import dynamic from 'next/dynamic'
import { useMemo, useRef } from 'react'
import type { AudioFrame } from '@/components/orb/SiriOrb'

// Client-only: the orb needs WebGL.
const SiriOrb = dynamic(() => import('@/components/orb/SiriOrb').then((m) => m.SiriOrb), { ssr: false })

export function Assistant({ analyser, isListening, isSpeaking }: {
  analyser: AnalyserNode | null   // your existing mic or playback analyser
  isListening: boolean
  isSpeaking: boolean
}) {
  const time = useRef<Uint8Array<ArrayBuffer>>(null)
  const freq = useRef<Uint8Array<ArrayBuffer>>(null)

  // Read the analyser each animation frame; no React state per sample.
  const getAudioFrame = useMemo(() => (): AudioFrame | null => {
    if (!analyser) return null
    time.current ??= new Uint8Array(analyser.fftSize)
    freq.current ??= new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(time.current)
    analyser.getByteFrequencyData(freq.current)
    let sum = 0
    for (const v of time.current) sum += ((v - 128) / 128) ** 2
    return { level: Math.min(1, Math.sqrt(sum / time.current.length) * 5), bands: freq.current }
  }, [analyser])

  return (
    <SiriOrb
      size="min(60vw, 280px)"
      theme="auto"
      state={isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle'}
      getAudioFrame={getAudioFrame}
      glowIntensity={1}
    />
  )
}
```

If you'd rather pass plain values (for example, from a WebSocket at around 30 Hz):

```tsx
<SiriOrb state="speaking" audioLevel={level} frequencyBands={bands} theme={siteTheme} />
```

Values are smoothed inside the component with fast attack and gentle release, so sparse or jittery updates still animate fluidly.
