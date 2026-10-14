'use client'

import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Mesh, NoBlending, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector4, WebGLRenderer } from 'three'
import { fragmentShader, vertexShader } from './shaders'

/**
 * Siri-inspired glass orb rendered with Three.js and GLSL.
 *
 * The orb only visualises audio; the host app owns recording/playback and
 * feeds intensity in one of three ways (highest priority first):
 *   1. `getAudioFrame` — polled every animation frame, no React re-renders
 *   2. the imperative handle: `ref.current.setAudio(level, bands)`
 *   3. the `audioLevel` / `frequencyBands` props
 *
 * States follow Siri's behaviour: `idle` rests as a thin arc of white light
 * that breathes quietly; `listening` and `speaking` open it into ribbons that
 * widen and twist with the audio level and bands (white rings ripple out when
 * it wakes; speaking adds brightness and halation); `thinking` settles the
 * light while a comet circles the rim.
 *
 * Dark glass only adds light (screen blending) with a faint halo; light glass
 * is clear crystal with a silver rim and a soft drop shadow.
 *
 * @example
 * <SiriOrb size={240} theme="auto" state={speaking ? 'speaking' : 'listening'} audioLevel={level} />
 */

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking'
export type OrbTheme = 'auto' | 'light' | 'dark'

export interface AudioFrame {
  /** Normalised intensity, 0..1. */
  level: number
  /** Optional frequency magnitudes (any length), each 0..1. Reduced to 4 bands. */
  bands?: ArrayLike<number>
}

export interface SiriOrbProps {
  /** Sphere diameter: pixels, or any CSS length (e.g. "min(60vw, 320px)"). */
  size?: number | string
  theme?: OrbTheme
  state?: OrbState
  /** Normalised audio intensity, 0..1. */
  audioLevel?: number
  /** Optional frequency magnitudes, each 0..1. */
  frequencyBands?: ArrayLike<number>
  /** Per-frame audio source; avoids re-rendering React for every audio sample. */
  getAudioFrame?: () => AudioFrame | null | undefined
  /** Outer glow strength, 0 (none) to ~2. Default 1. */
  glowIntensity?: number
  className?: string
  style?: CSSProperties
  /** Accessible label. The orb is decorative (aria-hidden) when omitted. */
  label?: string
}

export interface SiriOrbHandle {
  /** Push the latest audio intensity (0..1) and optional bands. */
  setAudio: (level: number, bands?: ArrayLike<number>) => void
}

// The canvas extends past the sphere on every side so the glow can fall off softly.
const HALO = 0.2
const SPHERE_RADIUS = 1 / (1 + 2 * HALO)

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Averages any number of magnitudes into four bands (accepts 0..1 or 0..255). */
function toBands(values: ArrayLike<number> | undefined, out: number[]): number[] {
  if (!values || values.length === 0) {
    out.fill(0)
    return out
  }
  let max = 0
  for (let i = 0; i < values.length; i++) max = Math.max(max, values[i])
  const scale = max > 1.5 ? 1 / 255 : 1
  for (let b = 0; b < 4; b++) {
    const start = Math.floor((b / 4) * values.length)
    const end = Math.max(start + 1, Math.floor(((b + 1) / 4) * values.length))
    let sum = 0
    for (let i = start; i < end && i < values.length; i++) sum += values[i]
    out[b] = clamp01((sum / (end - start)) * scale)
  }
  return out
}

function pageIsDark(): boolean {
  const root = document.documentElement
  if (root.classList.contains('dark') || root.dataset.theme === 'dark') return true
  if (root.classList.contains('light') || root.dataset.theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const SiriOrbImpl = forwardRef<SiriOrbHandle, SiriOrbProps>(function SiriOrb(
  {
    size = 240,
    theme = 'auto',
    state = 'idle',
    audioLevel = 0,
    frequencyBands,
    getAudioFrame,
    glowIntensity = 1,
    className,
    style,
    label,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState(false)

  // Latest props, read by the render loop without restarting it.
  const props = useRef({ state, audioLevel, frequencyBands, getAudioFrame, glowIntensity })
  const pushed = useRef<{ level: number; bands?: ArrayLike<number>; at: number } | null>(null)
  const themeRef = useRef(theme)
  const darkTarget = useRef(0)
  const refreshTheme = useRef<() => void>(() => undefined)

  useEffect(() => {
    props.current = { state, audioLevel, frequencyBands, getAudioFrame, glowIntensity }
  })

  useEffect(() => {
    themeRef.current = theme
    refreshTheme.current()
  }, [theme])

  useImperativeHandle(ref, () => ({
    setAudio: (level, bands) => {
      pushed.current = { level, bands, at: performance.now() }
    },
  }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (!webglAvailable()) {
      setFallback(true)
      return
    }

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'default' })
    } catch {
      setFallback(true)
      return
    }
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
      position: 'absolute',
      left: `${-HALO * 100}%`,
      top: `${-HALO * 100}%`,
      width: `${(1 + 2 * HALO) * 100}%`,
      height: `${(1 + 2 * HALO) * 100}%`,
      pointerEvents: 'none',
      display: 'block',
    } satisfies Partial<CSSStyleDeclaration>)
    container.appendChild(canvas)

    const uniforms = {
      uTime: { value: 0 },
      uLevel: { value: 0.1 },
      uEnergy: { value: 0 },
      uBands: { value: new Vector4(0, 0, 0, 0) },
      uDark: { value: 0 },
      uGlow: { value: props.current.glowIntensity },
      uPx: { value: 0.01 },
      uRadius: { value: SPHERE_RADIUS },
      uThinking: { value: 0 },
      uListen: { value: 0 },
      uSpin: { value: 0 },
      uRipple: { value: 1.5 },
      uIntro: { value: 0 },
    }
    const material = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      premultipliedAlpha: true,
    })
    const geometry = new PlaneGeometry(2, 2)
    const quad = new Mesh(geometry, material)
    quad.frustumCulled = false // positioned in clip space by the vertex shader
    const scene = new Scene()
    scene.add(quad)
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // --- Sizing -----------------------------------------------------------
    const resize = () => {
      const cssSize = container.clientWidth * (1 + 2 * HALO)
      if (cssSize <= 0) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(dpr)
      renderer.setSize(cssSize, cssSize, false)
      uniforms.uPx.value = 2 / (cssSize * dpr)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    // --- Theme: follows the page (class/data-theme/OS) unless overridden ------
    const updateTheme = () => {
      const mode = themeRef.current
      darkTarget.current = mode === 'dark' ? 1 : mode === 'light' ? 0 : pageIsDark() ? 1 : 0
    }
    updateTheme()
    uniforms.uDark.value = darkTarget.current // no fade on first paint
    refreshTheme.current = updateTheme
    const themeObserver = new MutationObserver(updateTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    colorScheme.addEventListener('change', updateTheme)

    // --- Motion preferences -------------------------------------------------
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = reducedMotionQuery.matches
    const onReducedMotion = () => {
      reducedMotion = reducedMotionQuery.matches
    }
    reducedMotionQuery.addEventListener('change', onReducedMotion)

    // --- Render loop --------------------------------------------------------
    const rawBands = [0, 0, 0, 0]
    let level = 0.1
    let energy = 0
    let clock = Math.random() * 100
    let last = performance.now()
    let frame = 0
    let running = false
    let visible = true
    let previousState = props.current.state

    const readAudio = (): { level: number; bands?: ArrayLike<number> } => {
      const p = props.current
      const frameData = p.getAudioFrame?.()
      if (frameData) return frameData
      const push = pushed.current
      if (push && performance.now() - push.at < 500) return push
      return { level: p.audioLevel, bands: p.frequencyBands }
    }

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const p = props.current

      let target: number
      let energyTarget = 0
      let bandsSource: ArrayLike<number> | undefined
      if (p.state === 'idle') {
        // Gentle breathing even in silence.
        target = 0.1 + 0.035 * Math.sin(clock * 0.8) + 0.02 * Math.sin(clock * 1.9 + 1.3)
      } else if (p.state === 'thinking') {
        // The waveform settles into a slow, calm breath while the comet circles.
        target = 0.12 + 0.04 * Math.sin(clock * 1.4)
      } else {
        const audio = readAudio()
        target = clamp01(audio.level)
        bandsSource = audio.bands
        energyTarget = p.state === 'speaking' ? target : target * 0.35
        target = Math.max(target, 0.07)
      }
      if (reducedMotion) target = Math.min(target, 0.3)

      // Attack/release smoothing (frame-rate independent).
      const attack = 1 - Math.exp(-dt * 16)
      const release = 1 - Math.exp(-dt * 4)
      level += (target - level) * (target > level ? attack : release)
      energy += (energyTarget - energy) * (energyTarget > energy ? attack : release)
      toBands(bandsSource, rawBands)
      const b = uniforms.uBands.value
      b.set(
        b.x + (rawBands[0] - b.x) * (rawBands[0] > b.x ? attack : release),
        b.y + (rawBands[1] - b.y) * (rawBands[1] > b.y ? attack : release),
        b.z + (rawBands[2] - b.z) * (rawBands[2] > b.z ? attack : release),
        b.w + (rawBands[3] - b.w) * (rawBands[3] > b.w ? attack : release),
      )

      // Wake ripple when the orb starts listening or speaking.
      const active = p.state === 'listening' || p.state === 'speaking'
      const wasActive = previousState === 'listening' || previousState === 'speaking'
      if (active && !wasActive && !reducedMotion) uniforms.uRipple.value = 0
      previousState = p.state
      uniforms.uRipple.value = Math.min(1.5, uniforms.uRipple.value + dt / 1.25)

      const ease = (rate: number) => 1 - Math.exp(-dt * rate)
      uniforms.uThinking.value += ((p.state === 'thinking' ? 1 : 0) - uniforms.uThinking.value) * ease(4)
      uniforms.uListen.value += ((active ? 1 : 0) - uniforms.uListen.value) * ease(5)
      uniforms.uSpin.value += dt * (reducedMotion ? 0.8 : 2.6)
      uniforms.uIntro.value = reducedMotion ? 1 : Math.min(1, uniforms.uIntro.value + dt / 1.1)

      // Delicate, unhurried motion; louder audio flows a little faster.
      const base = p.state === 'idle' ? 0.45 : p.state === 'thinking' ? 0.5 : 0.6 + level * 0.5
      const tempo = base * (reducedMotion ? 0.25 : 1)
      clock += dt * tempo
      uniforms.uTime.value = clock
      uniforms.uLevel.value = level
      uniforms.uEnergy.value = energy
      uniforms.uGlow.value = Math.max(0, p.glowIntensity)
      uniforms.uDark.value += (darkTarget.current - uniforms.uDark.value) * (1 - Math.exp(-dt * 5))

      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }

    const start = () => {
      if (running || !visible || document.hidden) return
      running = true
      last = performance.now()
      frame = requestAnimationFrame(render)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(frame)
    }

    // Pause when off screen or in a background tab.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) start()
      else stop()
    })
    intersection.observe(container)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    const onContextLost = (event: Event) => {
      event.preventDefault()
      stop()
    }
    const onContextRestored = () => start()
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    start()

    return () => {
      refreshTheme.current = () => undefined
      stop()
      intersection.disconnect()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      colorScheme.removeEventListener('change', updateTheme)
      reducedMotionQuery.removeEventListener('change', onReducedMotion)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [])

  const dimension = typeof size === 'number' ? `${size}px` : size

  return (
    <div
      ref={containerRef}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        position: 'relative',
        width: dimension,
        height: dimension,
        aspectRatio: '1 / 1',
        flexShrink: 0,
        isolation: 'isolate',
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          pointerEvents: 'none',
          backdropFilter: 'blur(5px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(5px) saturate(1.6)',
        }}
      />
      {fallback && (
        // Minimal static stand-in when WebGL is unavailable: clear glass, a
        // silver rim, and a white arc over a soft grey shadow.
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: [
              'radial-gradient(ellipse 34% 2.2% at 50% 47%, rgba(255,255,255,.95), rgba(255,255,255,0))',
              'radial-gradient(ellipse 30% 4% at 50% 51%, rgba(80,90,110,.16), rgba(80,90,110,0))',
              'radial-gradient(circle at 50% 50%, rgba(205,220,242,.05) 55%, rgba(170,180,200,.12) 92%, rgba(170,180,200,.22) 100%)',
            ].join(', '),
            boxShadow: 'inset 0 0 0 1px rgba(140,150,170,.3), inset 0 0 0 2px rgba(255,255,255,.6), 0 8px 22px rgba(0,0,0,.08)',
          }}
        />
      )}
    </div>
  )
})

export const SiriOrb = memo(SiriOrbImpl)
