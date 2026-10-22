import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { onCoachCue } from '@/lib/coachCues'

/** What the coach is up to, for the little extras drawn around it (z's, hearts, sparkles, stars). */
export type CoachMood = 'idle' | 'asleep' | 'love' | 'cheer' | 'dizzy'

export interface Coach3DProps {
  /** Diameter of the head in CSS pixels; the canvas is a little larger so hops and tilts never clip. */
  size: number
  /** The pointer is on the coach: smiling eyes, and heart eyes if it stays. */
  happy?: boolean
  /** Reduced motion: no floating or drifting about; hops and wiggles are smaller. */
  still?: boolean
  /** Out of sight (the chat is open): the loop sleeps, and the coach says hello when it comes back. */
  hidden?: boolean
  /** Change this number to make the coach wave hello and look at its greeting bubble. */
  cue?: number
  /** The coach is being pressed: it squishes, and springs back on release. */
  pressed?: boolean
  /** Called when the mood changes. */
  onMood?: (mood: CoachMood) => void
  /** Called when nobody has come near for a while and the coach hops to get attention. */
  onNudge?: () => void
  /** Called once the first frame is on screen. */
  onReady?: () => void
  /** Called if WebGL is missing or lost, so the flat face can take over. */
  onFail?: () => void
}

const PAD = 1.3 // canvas size relative to the head
const FOV = 22
// The face screen: an ellipsoid of black glass set into the front of the head.
const VISOR = { x: 0.74, y: 0.56, z: 0.5, at: 0.56, drop: -0.03 }
// The eyes are drawn on a canvas laid over the screen's curve.
const EYES = { w: 1.0, h: 0.66, px: 300, py: 198 }
/** The coach only notices the pointer within this many pixels. */
const NOTICE_RADIUS = 300
/** Pixels at which the coach has turned fully towards the pointer. */
const FULL_TURN = 170
const NUDGE_AFTER_MS = 25_000
const SLEEP_AFTER_MS = 60_000

/** Height of the screen's surface at (x, y), so the eyes sit right on the glass. */
function screenDepth(x: number, y: number) {
  const k = 1 - (x * x) / (VISOR.x * VISOR.x) - (y - VISOR.drop) ** 2 / (VISOR.y * VISOR.y)
  return VISOR.at + VISOR.z * Math.sqrt(Math.max(0, k))
}

/**
 * A photo studio to reflect: a dome that is light above and dark below, a large softbox up and to the
 * left, a cool strip light behind on the right and a low fill. The reflections land on the edges of
 * the head and screen, never across the eyes.
 */
function studio() {
  const scene = new Scene()
  const dome = new SphereGeometry(10, 32, 16)
  const position = dome.getAttribute('position')
  const colours = new Float32Array(position.count * 3)
  const top = new Color('#ffffff').multiplyScalar(1.25)
  const horizon = new Color('#c3c8d4').multiplyScalar(0.85)
  const floor = new Color('#3a3e4a').multiplyScalar(0.45)
  const colour = new Color()
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / 10
    if (y > 0) colour.lerpColors(horizon, top, Math.pow(y, 0.7))
    else colour.lerpColors(horizon, floor, Math.pow(-y, 0.6))
    colour.toArray(colours, i * 3)
  }
  dome.setAttribute('color', new Float32BufferAttribute(colours, 3))
  scene.add(new Mesh(dome, new MeshBasicMaterial({ side: BackSide, vertexColors: true })))
  const light = (w: number, h: number, colour: Color, x: number, y: number, z: number) => {
    const panel = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: colour, side: DoubleSide }))
    panel.position.set(x, y, z)
    panel.lookAt(0, 0, 0)
    scene.add(panel)
  }
  light(7, 2.4, new Color('#ffffff').multiplyScalar(3), -3.5, 6, 3.5)
  light(1.6, 6, new Color('#cfe0ff').multiplyScalar(1.8), 7, 0.5, -2.5)
  light(5, 1.2, new Color('#ffffff').multiplyScalar(0.9), 1.5, -5, 6)
  return scene
}

function disposeScene(scene: Scene) {
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      ;(object.material as MeshBasicMaterial).dispose()
    }
  })
}

function capsule(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const r = Math.min(w, h) / 2
  const x = cx - w / 2
  const y = cy - h / 2
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function heart(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.beginPath()
  g.moveTo(cx, cy + s * 0.95)
  g.bezierCurveTo(cx - s * 1.7, cy - s * 0.1, cx - s * 0.85, cy - s * 1.35, cx, cy - s * 0.42)
  g.bezierCurveTo(cx + s * 0.85, cy - s * 1.35, cx + s * 1.7, cy - s * 0.1, cx, cy + s * 0.95)
  g.closePath()
}

/** What the eyes are doing; every field eases, so expressions blend into each other. */
interface Face {
  lookX: number
  lookY: number
  /** How open each eye is, 0..1 (blinks, winks, sleepiness). */
  open: [number, number]
  /** Smiling arcs. */
  arc: number
  /** Heart eyes. */
  heart: number
  /** Wide, surprised eyes. */
  wide: number
  /** Spiral eyes, and how far they have turned. */
  dizzy: number
  spin: number
}

/** Two glowing eyes: tall pills that blink and look around, smiling arcs, or hearts. */
function drawEyes(g: CanvasRenderingContext2D, face: Face) {
  const { px: W, py: H } = EYES
  g.clearRect(0, 0, W, H)
  const light = g.createLinearGradient(W * 0.28, 0, W * 0.72, 0)
  light.addColorStop(0, '#7fe3ff')
  light.addColorStop(1, '#b3a4ff')
  const love = g.createLinearGradient(0, H * 0.25, 0, H * 0.75)
  love.addColorStop(0, '#ff9ec4')
  love.addColorStop(1, '#ff5c8d')
  g.lineCap = 'round'
  g.lineWidth = 16
  const ox = face.lookX * 26
  const oy = face.lookY * 16
  const calm = 1 - face.dizzy
  const pill = (1 - face.arc) * (1 - face.heart) * calm
  const arc = face.arc * (1 - face.heart) * calm
  // A soft blush on the screen, under the eyes, when happy or smitten.
  const blush = Math.max(face.arc, face.heart) * calm
  if (blush > 0.01) {
    g.shadowBlur = 0
    for (const side of [-1, 1]) {
      const bx = W / 2 + side * 76 + ox
      const by = H / 2 + 46 + oy
      const glow = g.createRadialGradient(bx, by, 0, bx, by, 26)
      glow.addColorStop(0, `rgba(255, 120, 170, ${0.55 * blush})`)
      glow.addColorStop(1, 'rgba(255, 120, 170, 0)')
      g.fillStyle = glow
      g.fillRect(bx - 30, by - 20, 60, 40)
    }
  }
  for (const [i, side] of [-1, 1].entries()) {
    const cx = W / 2 + side * 60 + ox
    const cy = H / 2 + 6 + oy
    g.shadowColor = 'rgba(120, 200, 255, 0.9)'
    g.shadowBlur = 26 + face.wide * 16
    g.fillStyle = light
    g.strokeStyle = light
    if (pill > 0.01) {
      const w = 50 + face.wide * 10
      const h = Math.max(10, (84 + face.wide * 14) * face.open[i])
      g.globalAlpha = pill
      capsule(g, cx, cy, w, h)
      g.fill()
      // A bright core, so the eye looks lit from within.
      g.globalAlpha = pill * 0.55
      g.fillStyle = '#ffffff'
      g.shadowBlur = 10
      capsule(g, cx - w * 0.06, cy - h * 0.08, w * 0.42, Math.max(4, h * 0.56))
      g.fill()
      g.fillStyle = light
      g.shadowBlur = 26 + face.wide * 16
    }
    if (arc > 0.01) {
      g.globalAlpha = arc
      g.beginPath()
      g.arc(cx, cy + 22, 30, Math.PI * 1.15, Math.PI * 1.85)
      g.stroke()
    }
    if (face.dizzy > 0.01) {
      g.globalAlpha = face.dizzy
      g.lineWidth = 7
      g.beginPath()
      for (let a = 0; a <= Math.PI * 4.2; a += 0.15) {
        const r = 3 + a * 2.9
        const angle = side * (a + face.spin)
        const x = cx + r * Math.cos(angle)
        const y = cy + r * Math.sin(angle)
        if (a === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      g.lineWidth = 16
    }
    if (face.heart > 0.01) {
      g.globalAlpha = face.heart * calm
      g.shadowColor = 'rgba(255, 110, 160, 0.9)'
      g.fillStyle = love
      heart(g, cx, cy, 26 + face.heart * 4)
      g.fill()
    }
  }
  g.globalAlpha = 1
}

/** A damped spring, for hops, wiggles and squash. */
class Spring {
  value = 0
  velocity = 0
  target = 0
  constructor(
    private stiffness: number,
    private damping: number,
  ) {}
  kick(velocity: number) {
    this.velocity += velocity
  }
  step(dt: number) {
    this.velocity += (-this.stiffness * (this.value - this.target) - this.damping * this.velocity) * dt
    this.value += this.velocity * dt
    return this.value
  }
  get resting() {
    return Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.005
  }
}

/**
 * The coach as a small 3D character: a pearl-white head with a black glass face and two glowing eyes.
 *
 * It notices the pointer only when it comes near (wide eyes and a little hop), then turns to follow it.
 * It smiles with its eyes when pointed at, turns to heart eyes if you stay, squishes when pressed, and
 * gets dizzy if you dart on and off it. Its eyes follow the page as you scroll. It cheers a great
 * attempt and nods at an ordinary one. Left alone it blinks, glances about, now and then winks, hops or
 * wiggles, hops for attention after a while, and later gets sleepy until the pointer comes back.
 */
export default function Coach3D({
  size,
  happy = false,
  still = false,
  hidden = false,
  cue = 0,
  pressed = false,
  onMood,
  onNudge,
  onReady,
  onFail,
}: Coach3DProps) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ happy, still, hidden, pressed })
  live.current = { happy, still, hidden, pressed }
  const callbacks = useRef({ onReady, onFail, onMood, onNudge })
  callbacks.current = { onReady, onFail, onMood, onNudge }
  // Set up by the scene: wakes the loop, and plays a gesture.
  const control = useRef<{ wake: () => void; hello: () => void } | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const box = Math.round(size * PAD)

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      callbacks.current.onFail?.()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(box, box)
    renderer.toneMapping = NeutralToneMapping
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    element.appendChild(canvas)

    const scene = new Scene()
    const pmrem = new PMREMGenerator(renderer)
    const room = studio()
    const environment = pmrem.fromScene(room, 0.02).texture
    disposeScene(room)
    scene.environment = environment

    // Frame the head so it fills `size` pixels of the `box`-pixel canvas.
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 50)
    const half = MathUtils.degToRad(FOV / 2)
    camera.position.set(0, 0, 1 / Math.sin(Math.atan(Math.tan(half) / PAD)))

    const key = new DirectionalLight('#ffffff', 1.3)
    key.position.set(-2.5, 3.5, 4)
    const rim = new DirectionalLight('#cfe0ff', 0.6)
    rim.position.set(3, -1.5, -2)
    scene.add(key, rim)

    const disposables: { dispose(): void }[] = [pmrem, environment]
    const keep = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing)

    const head = new Group()
    scene.add(head)

    // Shell: soft-touch white, matte with a faint satin sheen.
    const shell = keep(
      new MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.6,
        clearcoat: 0.25,
        clearcoatRoughness: 0.55,
        sheen: 0.35,
        sheenColor: new Color('#ffffff'),
        sheenRoughness: 0.8,
        envMapIntensity: 0.9,
      }),
    )
    const sphere = keep(new SphereGeometry(1, 72, 56))
    head.add(new Mesh(sphere, shell))

    // Face screen: satin black glass, with only a soft sheen of the studio in it.
    const glass = keep(
      new MeshPhysicalMaterial({ color: '#07080d', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.3 }),
    )
    const visor = new Mesh(sphere, glass)
    visor.scale.set(VISOR.x, VISOR.y, VISOR.z)
    visor.position.set(0, VISOR.drop, VISOR.at)
    head.add(visor)

    // A little antenna with a glowing bead, a touch to the right of the crown. It lags behind the
    // head's moves and jiggles, and its bead takes the colour of the coach's mood.
    const ANTENNA_TILT = -0.32
    const antenna = new Group()
    antenna.position.set(Math.sin(-ANTENNA_TILT) * 0.97, Math.cos(ANTENNA_TILT) * 0.97, 0.05)
    antenna.rotation.z = ANTENNA_TILT
    const stem = new Mesh(keep(new CylinderGeometry(0.02, 0.028, 0.2, 14)), shell)
    stem.position.y = 0.1
    const beadMaterial = keep(
      new MeshPhysicalMaterial({ color: '#dff8ff', emissive: '#6fdcff', emissiveIntensity: 1.3, roughness: 0.25, clearcoat: 1 }),
    )
    const bead = new Mesh(keep(new SphereGeometry(0.068, 24, 18)), beadMaterial)
    bead.position.y = 0.22
    antenna.add(stem, bead)
    head.add(antenna)
    const beadColours: Record<CoachMood, Color> = {
      idle: new Color('#6fdcff'),
      asleep: new Color('#3a5a73'),
      love: new Color('#ff6fa3'),
      cheer: new Color('#ffcc33'),
      dizzy: new Color('#b3a4ff'),
    }
    const beadNow = new Color('#6fdcff')

    // A soft shadow under the head that shrinks and fades as it hops.
    const shadowCanvas = document.createElement('canvas')
    shadowCanvas.width = shadowCanvas.height = 64
    const shade = shadowCanvas.getContext('2d')!
    const fall = shade.createRadialGradient(32, 32, 0, 32, 32, 32)
    fall.addColorStop(0, 'rgba(0,0,0,1)')
    fall.addColorStop(0.5, 'rgba(0,0,0,0.45)')
    fall.addColorStop(1, 'rgba(0,0,0,0)')
    shade.fillStyle = fall
    shade.fillRect(0, 0, 64, 64)
    const shadowTexture = keep(new CanvasTexture(shadowCanvas))
    const shadowMaterial = keep(
      new MeshBasicMaterial({ map: shadowTexture, color: '#141a2e', transparent: true, opacity: 0.32, depthWrite: false }),
    )
    const shadow = new Mesh(keep(new PlaneGeometry(1.7, 0.42)), shadowMaterial)
    shadow.position.set(0, -1.02, -0.6)
    scene.add(shadow)

    // Eyes: a canvas of light that follows the screen's curve, added on top of the glass.
    const eyeCanvas = document.createElement('canvas')
    eyeCanvas.width = EYES.px
    eyeCanvas.height = EYES.py
    const pen = eyeCanvas.getContext('2d')!
    const eyeTexture = keep(new CanvasTexture(eyeCanvas))
    eyeTexture.colorSpace = SRGBColorSpace
    const eyeGeometry = keep(new PlaneGeometry(EYES.w, EYES.h, 24, 16))
    const position = eyeGeometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      position.setZ(i, screenDepth(position.getX(i), position.getY(i)) + 0.006)
    }
    eyeGeometry.computeVertexNormals()
    const eyeMaterial = keep(
      new MeshBasicMaterial({ map: eyeTexture, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    )
    head.add(new Mesh(eyeGeometry, eyeMaterial))

    // ---- Behaviour ----
    const start = performance.now()
    const face: Face = { lookX: 0, lookY: 0, open: [1, 1], arc: 0, heart: 0, wide: 0, dizzy: 0, spin: 0 }
    const drawn = { key: '' }
    const gaze = { x: 0, y: 0, tx: 0, ty: 0 }
    const pointer = { near: false, at: 0, x: 0, y: 0 }
    const hop = new Spring(170, 11)
    const wiggle = new Spring(140, 6)
    const squish = new Spring(320, 13)
    const nod = new Spring(110, 8)
    const swing = new Spring(90, 4.5)
    const bob = new Spring(120, 5)
    const before = { y: 0, z: 0, lift: 0 }
    const until = { glee: 0, wide: 0, wink: 0, dizzy: 0, cheer: 0 }
    const scroll = { dir: 0, until: 0 }
    let hoverEnters: number[] = []
    let wasHappy = false
    let nudged = false
    let mood: CoachMood = 'idle'
    let winkEye = 0
    let lastSeen = start // the last time someone was near or interacting
    let asleep = false
    let hoverSince = 0
    let blinkAt = start + 2200
    let blinkDouble = false
    let glanceAt = start + 4000
    let gestureAt = start + MathUtils.randFloat(16_000, 24_000)
    let glances: { at: number; x: number; y: number }[] = []
    let wasHidden = live.current.hidden
    let frame = 0
    let ready = false
    let lost = false
    let last = start
    let rect = element.getBoundingClientRect()

    const measure = () => (rect = element.getBoundingClientRect())
    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.at = performance.now()
      wake()
    }
    const onLeave = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        pointer.at = 0
        wake()
      }
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('pointerout', onLeave)
    // While the page scrolls, the eyes follow it up or down.
    const scrolled = new WeakMap<object, number>()
    const onScroll = (event: Event) => {
      measure()
      const target = event.target === document ? document.scrollingElement : (event.target as Element | null)
      if (!target) return
      const y = target.scrollTop
      const before = scrolled.get(target) ?? y
      scrolled.set(target, y)
      if (Math.abs(y - before) > 2) {
        scroll.dir = Math.sign(y - before)
        scroll.until = performance.now() + 450
        wake()
      }
    }
    const offCue = onCoachCue((cue) => {
      if (live.current.hidden) return
      const now = performance.now()
      if (cue === 'cheer') moves.cheer(now)
      else moves.nod(now)
      lastSeen = now
      asleep = false
      wake()
    })
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })

    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancelAnimationFrame(frame)
      callbacks.current.onFail?.()
    }
    canvas.addEventListener('webglcontextlost', onLost)

    /** How big gestures are: smaller with reduced motion. */
    const amp = () => (live.current.still ? 0.6 : 1)
    /** Small gestures. */
    const moves = {
      wink(now: number) {
        winkEye = Math.random() < 0.5 ? 0 : 1
        until.wink = now + 420
      },
      glee(now: number, ms = 1000) {
        until.glee = now + ms
      },
      hop(now: number) {
        moves.glee(now, 900)
        hop.kick(2.6 * amp())
      },
      wiggle(now: number) {
        moves.glee(now, 1100)
        wiggle.kick(4.2 * amp())
      },
      notice(now: number) {
        until.wide = now + 520
        hop.kick(1.7 * amp())
      },
      cheer(now: number) {
        until.cheer = now + 1500
        moves.glee(now, 1600)
        hop.kick(3.4 * amp())
        wiggle.kick(2.5 * amp())
      },
      nod(now: number) {
        moves.glee(now, 800)
        nod.kick(3.2 * amp())
      },
      dizzy(now: number) {
        until.dizzy = now + 2200
        wiggle.kick(5 * amp())
      },
      /** Look over at the speech bubble to the left. */
      lookAtBubble(now: number, ms: number) {
        glances = [
          { at: now, x: -0.85, y: 0.05 },
          { at: now + ms, x: 0, y: 0 },
        ]
      },
      glance(now: number) {
        glances = [
          { at: now, x: -0.75, y: -0.15 },
          { at: now + 750, x: 0.55, y: -0.25 },
          { at: now + 1500, x: 0, y: 0 },
        ]
      },
    }
    const hello = () => {
      const now = performance.now()
      moves.wiggle(now)
      moves.lookAtBubble(now, 2600)
      until.wink = 0
      lastSeen = now
      asleep = false
      wake()
    }

    function wake() {
      if (!frame && !lost) frame = requestAnimationFrame(tick)
    }

    function tick(now: number) {
      frame = 0
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { happy: isHappy, still: isStill, hidden: isHidden } = live.current

      // Out of sight: sleep until shown again, then say hello.
      if (isHidden) {
        wasHidden = true
        return
      }
      if (wasHidden) {
        wasHidden = false
        moves.hop(now)
        lastSeen = now
        asleep = false
      }

      // Is the pointer near? Only then does the coach pay attention to it.
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = pointer.x - cx
      const dy = pointer.y - cy
      const near = pointer.at > 0 && Math.hypot(dx, dy) < NOTICE_RADIUS
      if (near && !pointer.near && (asleep || now - lastSeen > 3000)) moves.notice(now)
      pointer.near = near
      if (near || isHappy) {
        lastSeen = now
        asleep = false
        nudged = false
      } else if (now - lastSeen > SLEEP_AFTER_MS) {
        asleep = true
      } else if (!nudged && now - lastSeen > NUDGE_AFTER_MS) {
        // Nobody has come by for a while: hop and look over, and let the page say something.
        nudged = true
        moves.hop(now)
        moves.lookAtBubble(now, 2400)
        callbacks.current.onNudge?.()
      }

      if (isHappy && !hoverSince) hoverSince = now
      if (!isHappy) hoverSince = 0

      // Darting on and off it four times in quick succession makes it dizzy.
      if (isHappy && !wasHappy) {
        hoverEnters = [...hoverEnters.filter((at) => now - at < 2500), now]
        if (hoverEnters.length >= 4) {
          hoverEnters = []
          moves.dizzy(now)
        }
      }
      wasHappy = isHappy
      const dizzy = now < until.dizzy

      // Where to look: at a near pointer, through a planned glance, or about the room.
      glances = glances.filter((_, i) => i === glances.length - 1 || glances[i + 1].at > now)
      const glance = glances.find((g) => g.at <= now)
      if (dizzy) {
        gaze.tx = 0
        gaze.ty = 0
      } else if (near) {
        gaze.tx = MathUtils.clamp(dx / FULL_TURN, -1, 1)
        gaze.ty = MathUtils.clamp(dy / FULL_TURN, -1, 1)
      } else if (now < scroll.until) {
        gaze.tx = 0
        gaze.ty = scroll.dir * 0.75
      } else if (glance) {
        gaze.tx = glance.x
        gaze.ty = glance.y
        if (glance.x === 0 && glance.y === 0) glances = []
      } else if (asleep) {
        gaze.tx = 0
        gaze.ty = 0.5
      } else if (!isStill && now > glanceAt) {
        gaze.tx = Math.random() < 0.4 ? 0 : MathUtils.randFloat(-0.6, 0.35)
        gaze.ty = Math.random() < 0.4 ? 0 : MathUtils.randFloat(-0.45, 0.3)
        glanceAt = now + MathUtils.randFloat(2500, 5500)
      } else if (isStill) {
        gaze.tx = 0
        gaze.ty = 0
      }
      const follow = 1 - Math.exp(-dt * (near ? 9 : 5))
      gaze.x += (gaze.tx - gaze.x) * follow
      gaze.y += (gaze.ty - gaze.y) * follow

      // Now and then, when nobody is near, a little gesture to say it is here.
      if (now > gestureAt) {
        if (!near && !isHappy && !asleep) {
          const pick = ['wink', 'hop', 'wiggle', 'glance'] as const
          moves[pick[Math.floor(Math.random() * pick.length)]](now)
        }
        gestureAt = now + MathUtils.randFloat(16_000, 28_000)
      }

      // Blink every few seconds, sometimes twice; slowly when sleepy.
      let lid = 1
      const since = now - blinkAt
      if (since >= 0) {
        const p = since / (asleep ? 420 : 160)
        lid = p < 1 ? Math.abs(1 - 2 * p) : 1
        if (p >= 1) {
          if (!blinkDouble && !asleep && Math.random() < 0.22) {
            blinkDouble = true
            blinkAt = now + 90
          } else {
            blinkDouble = false
            blinkAt = now + MathUtils.randFloat(2600, 5600)
          }
        }
      }

      // Ease the expression towards its targets.
      const ease = (from: number, to: number, rate: number) => from + (to - from) * (1 - Math.exp(-dt * rate))
      const lovestruck = isHappy && !dizzy && now - hoverSince > 1600
      face.heart = ease(face.heart, lovestruck ? 1 : 0, 10)
      face.arc = ease(face.arc, isHappy || now < until.glee ? 1 : 0, 12)
      face.wide = ease(face.wide, now < until.wide ? 1 : 0, 16)
      face.dizzy = ease(face.dizzy, dizzy ? 1 : 0, 10)
      if (face.dizzy > 0.01) face.spin += dt * 7
      const base = asleep ? 0.16 : 1
      for (const i of [0, 1] as const) {
        const winking = now < until.wink && i === winkEye
        face.open[i] = ease(face.open[i], winking ? 0.08 : base, winking ? 30 : 8)
      }
      const shown: Face = { ...face, open: [face.open[0] * lid, face.open[1] * lid] }
      shown.lookX = gaze.x * 0.8
      shown.lookY = gaze.y * 0.8
      const key = [shown.lookX, shown.lookY, shown.open[0], shown.open[1], shown.arc, shown.heart, shown.wide, shown.dizzy, shown.spin]
        .map((v) => v.toFixed(3))
        .join()
      const faceChanged = key !== drawn.key
      if (faceChanged) {
        drawEyes(pen, shown)
        eyeTexture.needsUpdate = true
        drawn.key = key
      }

      // Say what it is up to, for the extras drawn around it.
      const nextMood: CoachMood = dizzy
        ? 'dizzy'
        : now < until.cheer
          ? 'cheer'
          : lovestruck
            ? 'love'
            : asleep
              ? 'asleep'
              : 'idle'
      if (nextMood !== mood) {
        mood = nextMood
        callbacks.current.onMood?.(mood)
      }

      // Move the head.
      const t = (now - start) / 1000
      squish.target = live.current.pressed ? 1 : 0
      const bounce = hop.step(dt)
      const sway = wiggle.step(dt)
      const press = squish.step(dt)
      const nodding = nod.step(dt)
      const float = isStill ? 0 : Math.sin(t * 1.7) * 0.03
      const wobble = face.dizzy * Math.sin(t * 9) * 0.09 * amp()
      head.position.y = float + bounce * 0.13 - press * 0.05
      const lift = MathUtils.clamp(head.position.y * 4, -0.3, 1)
      shadow.scale.set(1 - lift * 0.25 + press * 0.08, 1 - lift * 0.2, 1)
      shadowMaterial.opacity = 0.32 * (1 - lift * 0.45)
      head.rotation.y = gaze.x * 0.42
      head.rotation.x = gaze.y * 0.32 + (asleep ? 0.1 : 0) + nodding * 0.22
      head.rotation.z = -face.arc * 0.08 + sway * 0.05 + wobble + (isStill ? 0 : Math.sin(t * 0.9) * 0.02)
      const squash = MathUtils.clamp(hop.velocity * 0.035, -0.08, 0.08)
      head.scale.set(1 - squash * 0.5 + press * 0.07, 1 + squash - press * 0.12, 1 - squash * 0.5 + press * 0.04)

      // The antenna lags behind the head, then catches up with a jiggle.
      swing.kick(-((head.rotation.y - before.y) * 0.6 + (head.rotation.z - before.z)) * 26)
      bob.kick(-(head.position.y - before.lift) * 34)
      before.y = head.rotation.y
      before.z = head.rotation.z
      before.lift = head.position.y
      antenna.rotation.z = ANTENNA_TILT + swing.step(dt)
      antenna.rotation.x = bob.step(dt)
      beadNow.lerp(beadColours[mood], 1 - Math.exp(-dt * 6))
      beadMaterial.emissive.copy(beadNow)
      beadMaterial.emissiveIntensity = (mood === 'asleep' ? 0.5 : 1.3) + (isStill ? 0 : Math.sin(t * 2.2) * 0.25)

      const settled =
        isStill &&
        !faceChanged &&
        hop.resting &&
        wiggle.resting &&
        squish.resting &&
        nod.resting &&
        swing.resting &&
        bob.resting &&
        Math.abs(gaze.tx - gaze.x) < 0.002 &&
        Math.abs(gaze.ty - gaze.y) < 0.002
      if (!settled || !ready) renderer.render(scene, camera)
      if (!ready) {
        ready = true
        callbacks.current.onReady?.()
        window.setTimeout(() => moves.wink(performance.now()), 900)
      }
      frame = requestAnimationFrame(tick)
    }

    control.current = { wake, hello }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      control.current = null
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('pointerout', onLeave)
      offCue()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', onScroll, { capture: true })
      canvas.removeEventListener('webglcontextlost', onLost)
      for (const thing of disposables) thing.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [size])

  useEffect(() => control.current?.wake(), [happy, still, hidden, pressed])
  useEffect(() => {
    if (cue) control.current?.hello()
  }, [cue])

  const box = Math.round(size * PAD)
  return (
    <div
      ref={host}
      aria-hidden
      className="pointer-events-none"
      style={{ width: box, height: box, margin: (size - box) / 2 }}
    />
  )
}
