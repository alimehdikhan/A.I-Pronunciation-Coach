import { useEffect, useRef } from 'react'
import {
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export interface Coach3DProps {
  /** Diameter of the head in CSS pixels; the canvas is a little larger so squash and tilt never clip. */
  size: number
  /** Smiling eyes and a little tilt (hover, focus). */
  happy?: boolean
  /** Hold still: no floating, breathing or glancing around (blinks and following the pointer stay). */
  still?: boolean
  /** Called once the first frame is on screen. */
  onReady?: () => void
  /** Called if WebGL is missing or lost, so the flat face can take over. */
  onFail?: () => void
}

// The coach's colours, top left to bottom right (the same stops as `.bg-ai`).
const SKIN: [number, string][] = [
  [0, '#0894ff'],
  [0.38, '#c959dd'],
  [0.7, '#ff2e54'],
  [1, '#ff9004'],
]
const INK = '#1d1238'
const PAD = 1.18 // canvas size relative to the head
const FOV = 22

/** Paints the gradient onto the sphere as vertex colours, along the top-left to bottom-right diagonal. */
function paint(geometry: SphereGeometry) {
  const stops = SKIN.map(([at, hex]) => [at, new Color(hex)] as const)
  const axis = new Vector3(1, -1, 0.12).normalize()
  const position = geometry.getAttribute('position')
  const colours = new Float32Array(position.count * 3)
  const point = new Vector3()
  const colour = new Color()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize()
    const t = MathUtils.clamp((point.dot(axis) + 0.8) / 1.6, 0, 1)
    let k = 1
    while (k < stops.length - 1 && t > stops[k][0]) k++
    const [a, from] = stops[k - 1]
    const [b, to] = stops[k]
    colour.lerpColors(from, to, MathUtils.smoothstep(t, a, b))
    colour.toArray(colours, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3))
}

/** A soft round dot that fades to nothing at the edge (for the cheeks). */
function blushTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')!
  const fill = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  fill.addColorStop(0, 'rgba(255,255,255,1)')
  fill.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  fill.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = fill
  g.fillRect(0, 0, 64, 64)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Sits `object` on the head's surface at (x, y), facing outwards. */
function onSurface(object: Object3D, x: number, y: number, lift = 0) {
  const normal = new Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).normalize()
  object.position.copy(normal).multiplyScalar(1 + lift)
  object.lookAt(normal.multiplyScalar(2))
}

/**
 * The coach as a small 3D character: a glossy head in the coach's colours, dark glassy eyes with
 * sparkles, rosy cheeks and a smile. It follows the pointer with its eyes and head, blinks now and
 * then, floats and glances around when left alone, and smiles with its eyes when `happy`.
 */
export default function Coach3D({ size, happy = false, still = false, onReady, onFail }: Coach3DProps) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ happy, still })
  live.current = { happy, still }
  const callbacks = useRef({ onReady, onFail })
  callbacks.current = { onReady, onFail }
  // Wakes a sleeping loop when the mood or stillness changes.
  const kickRef = useRef<(() => void) | null>(null)

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
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    element.appendChild(canvas)

    const scene = new Scene()
    const pmrem = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = pmrem.fromScene(room, 0.04).texture
    scene.environment = environment
    scene.environmentIntensity = 0.6

    // Frame the head so it fills `size` pixels of the `box`-pixel canvas.
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 50)
    const half = MathUtils.degToRad(FOV / 2)
    camera.position.set(0, 0, 1 / Math.sin(Math.atan(Math.tan(half) / PAD)))

    const key = new DirectionalLight('#ffffff', 1.7)
    key.position.set(-2.2, 3, 4)
    const rim = new DirectionalLight('#ffd6f0', 1.2)
    rim.position.set(3, -1, -2.5)
    scene.add(key, rim)

    const disposables: { dispose(): void }[] = [pmrem, environment]
    const keep = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing)

    // Head
    const head = new Group()
    scene.add(head)
    const skinGeometry = keep(new SphereGeometry(1, 72, 56))
    paint(skinGeometry)
    const skin = keep(
      new MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.4,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        sheen: 0.2,
        sheenColor: new Color('#ffe3f6'),
        sheenRoughness: 0.5,
        iridescence: 0.1,
        iridescenceIOR: 1.25,
      }),
    )
    head.add(new Mesh(skinGeometry, skin))

    const ink = keep(
      new MeshPhysicalMaterial({ color: INK, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.35 }),
    )
    const sparkle = keep(new MeshBasicMaterial({ color: '#ffffff' }))

    // Eyes: tall glassy pills with two catchlights each.
    const eyeGeometry = keep(new CapsuleGeometry(0.12, 0.1, 8, 20))
    const bigSparkle = keep(new SphereGeometry(0.042, 12, 10))
    const smallSparkle = keep(new SphereGeometry(0.02, 10, 8))
    const eyes: Group[] = []
    for (const side of [-1, 1]) {
      const socket = new Group()
      onSurface(socket, side * 0.27, 0.06, -0.035)
      const eye = new Group()
      eye.scale.z = 0.5
      const pupil = new Mesh(eyeGeometry, ink)
      const glint = new Mesh(bigSparkle, sparkle)
      glint.position.set(-0.04, 0.07, 0.12)
      const glint2 = new Mesh(smallSparkle, sparkle)
      glint2.position.set(0.045, -0.05, 0.12)
      eye.add(pupil, glint, glint2)
      socket.add(eye)
      head.add(socket)
      eyes.push(eye)
    }

    // Happy eyes: little upturned arcs, hidden until `happy`.
    const arcGeometry = keep(new TorusGeometry(0.09, 0.034, 12, 32, Math.PI))
    const arcs: Group[] = []
    for (const side of [-1, 1]) {
      const socket = new Group()
      onSurface(socket, side * 0.27, 0.03, 0.005)
      const arc = new Group()
      arc.add(new Mesh(arcGeometry, ink))
      arc.scale.setScalar(0.001)
      socket.add(arc)
      head.add(socket)
      arcs.push(arc)
    }

    // Smile
    const smileGeometry = keep(new TorusGeometry(0.1, 0.032, 12, 36, Math.PI))
    const smileSocket = new Group()
    onSurface(smileSocket, 0, -0.2, 0.014)
    const smile = new Mesh(smileGeometry, ink)
    smile.rotation.z = Math.PI
    smileSocket.add(smile)
    head.add(smileSocket)

    // Cheeks
    const blush = keep(blushTexture())
    const cheekMaterial = keep(
      new MeshBasicMaterial({ map: blush, color: '#ff7ab8', transparent: true, opacity: 0.75, depthWrite: false }),
    )
    const cheekGeometry = keep(new CircleGeometry(0.17, 32))
    for (const side of [-1, 1]) {
      const cheek = new Mesh(cheekGeometry, cheekMaterial)
      onSurface(cheek, side * 0.5, -0.13, 0.018)
      head.add(cheek)
    }

    // Where the pointer is, relative to the coach, as -1..1 on each axis.
    const gaze = { x: 0, y: 0, tx: 0, ty: 0, movedAt: 0 }
    let rect = element.getBoundingClientRect()
    const measure = () => (rect = element.getBoundingClientRect())
    const onPointer = (event: PointerEvent) => {
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      gaze.tx = MathUtils.clamp((event.clientX - cx) / (window.innerWidth * 0.45), -1, 1)
      gaze.ty = MathUtils.clamp((event.clientY - cy) / (window.innerHeight * 0.45), -1, 1)
      gaze.movedAt = performance.now()
      wake()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true, capture: true })

    let blinkAt = performance.now() + 1800
    let blinkDouble = false
    let glanceAt = performance.now() + 4000
    let happiness = 0
    let frame = 0
    let ready = false
    let lost = false
    let last = performance.now()
    let settledFrames = 0
    let sleeper = 0

    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancelAnimationFrame(frame)
      callbacks.current.onFail?.()
    }
    canvas.addEventListener('webglcontextlost', onLost)

    function wake() {
      if (!frame && !lost) frame = requestAnimationFrame(tick)
    }

    function tick(now: number) {
      frame = 0
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { happy: isHappy, still: isStill } = live.current

      // Left alone for a while, the coach glances around by itself (unless holding still).
      if (!isStill && now - gaze.movedAt > 5000 && now > glanceAt) {
        gaze.tx = Math.random() < 0.35 ? 0 : MathUtils.randFloat(-0.8, 0.5)
        gaze.ty = Math.random() < 0.35 ? 0 : MathUtils.randFloat(-0.6, 0.4)
        glanceAt = now + MathUtils.randFloat(2200, 4800)
      }
      const follow = 1 - Math.exp(-dt * 7)
      gaze.x += (gaze.tx - gaze.x) * follow
      gaze.y += (gaze.ty - gaze.y) * follow
      happiness += ((isHappy ? 1 : 0) - happiness) * (1 - Math.exp(-dt * 14))

      const t = now / 1000
      const float = isStill ? 0 : Math.sin(t * 1.7) * 0.035
      const breathe = isStill ? 0 : Math.sin(t * 2.3) * 0.012
      head.rotation.y = gaze.x * 0.5
      head.rotation.x = gaze.y * 0.38
      head.rotation.z = -happiness * 0.12 + (isStill ? 0 : Math.sin(t * 0.9) * 0.025)
      head.position.y = float
      head.scale.set(1 - breathe * 0.5 + happiness * 0.03, 1 + breathe + happiness * 0.03, 1)

      // Blink: a quick close and open every few seconds, sometimes twice.
      let lid = 1
      const since = now - blinkAt
      if (since >= 0) {
        const p = since / 150
        lid = p < 1 ? Math.abs(1 - 2 * p) : 1
        if (p >= 1) {
          if (!blinkDouble && Math.random() < 0.22) {
            blinkDouble = true
            blinkAt = now + 90
          } else {
            blinkDouble = false
            blinkAt = now + MathUtils.randFloat(2600, 5600)
          }
        }
      }
      const open = Math.max(0.08, lid) * (1 - happiness)
      for (const eye of eyes) eye.scale.y = Math.max(0.001, open)
      for (const arc of arcs) arc.scale.setScalar(Math.max(0.001, happiness))
      smile.scale.setScalar(1 + happiness * 0.22)

      renderer.render(scene, camera)
      if (!ready) {
        ready = true
        callbacks.current.onReady?.()
      }

      // Keep animating while anything moves; when holding still, sleep once the gaze has settled
      // and wake for the next blink or pointer move.
      const moving =
        Math.abs(gaze.tx - gaze.x) > 0.002 ||
        Math.abs(gaze.ty - gaze.y) > 0.002 ||
        Math.abs((isHappy ? 1 : 0) - happiness) > 0.002 ||
        since >= 0
      settledFrames = moving ? 0 : settledFrames + 1
      if (!isStill || settledFrames < 3) {
        frame = requestAnimationFrame(tick)
      } else {
        sleeper = window.setTimeout(wake, Math.max(16, blinkAt - performance.now()))
      }
    }

    const kick = () => {
      window.clearTimeout(sleeper)
      wake()
    }
    kickRef.current = kick
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(sleeper)
      kickRef.current = null
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, { capture: true })
      canvas.removeEventListener('webglcontextlost', onLost)
      for (const thing of disposables) thing.dispose()
      room.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [size])

  useEffect(() => kickRef.current?.(), [happy, still])

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
