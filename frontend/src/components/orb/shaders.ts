/**
 * GLSL for the Siri-style glass orb.
 *
 * A single full-canvas quad is shaded analytically: the fragment shader
 * reconstructs a unit sphere, lenses the light suspended inside it, and
 * composites everything as premultiplied alpha so the canvas stays
 * transparent over any page.
 *
 * At rest the light is a thin, level white arc, hottest in the middle, whose
 * ends curve down and fade into the rim; colour only splits off at its edges.
 * While listening or speaking it opens into ribbons of silk that widen and
 * twist with the voice. The bubble is clear: a Fresnel rim confined to the
 * outer few percent of the radius, light gathering in its lower half, a soft
 * specular at the top left, and a 1–2 px dispersive split on the rim (warm on
 * the left, blue on the right).
 *
 * Dark glass only ever adds light (screen blending), so it is never darker
 * than the page behind it. Light glass is painted with normal "over"
 * blending: a thin silver rim, a faint cool tint, a white streak over a soft
 * grey shadow and a drop shadow instead of a glow.
 */

export const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const fragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform float uLevel;    // smoothed audio intensity, 0..1
uniform float uEnergy;   // extra brightness while speaking, 0..1
uniform vec4 uBands;     // smoothed low / low-mid / high-mid / high bands, 0..1
uniform float uDark;     // 0 = light glass, 1 = dark glass (animated between)
uniform float uGlow;     // outer halo strength (dark glass)
uniform float uPx;       // one device pixel in canvas space ([-1, 1] spans the canvas)
uniform float uRadius;   // sphere radius in canvas space
uniform float uThinking; // 0..1, the light settles and the loading comet appears
uniform float uListen;   // 0..1, listening or speaking: ribbons open up with the voice
uniform float uSpin;     // loading comet angle (radians)
uniform float uRipple;   // wake ripple progress, 0..1 (inactive when >= 1)
uniform float uIntro;    // 0..1 entrance: light blooms out from the centre

const float PI = 3.14159265;
const vec3 SILK = vec3(1.0, 0.975, 0.95);
const float ARC_Y = -0.05;  // height of the arc's ends (its middle bows up from here)

float gauss(float x, float c, float w) {
  float d = (x - c) / w;
  return exp(-d * d);
}

// Premultiplied "over": paints colour c at opacity a on top of dst.
vec4 over(vec4 dst, vec3 c, float a) {
  return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

// Cross-section of a thin line of light, dy from its centre. Red sits a touch
// above and blue a touch below with green between them, so the core stays
// white and colour only appears at the two edges (warm on top, cool below).
vec3 silkLine(float dy, float w, float split) {
  float r = gauss(dy, split, w);
  float b = gauss(dy, -split, w);
  return vec3(r, 0.5 * (r + b), b);
}

// Centre line of the light: a level, shallow arc whose ends curve down into
// the rim, flexing very slowly.
float arcY(float x, float t) {
  float u = x / 0.98;
  float bend = 0.05 + 0.012 * sin(0.31 * t);
  return ARC_Y + bend * (1.0 - u * u);
}

// The resting light: a thin white arc, hottest in the middle, its ends fading
// out into the rim. rgb = light; a = the soft shadow it casts on light glass.
vec4 restingArc(vec2 q, float t, float pxq) {
  float u = q.x / 0.98;
  float span = clamp(1.0 - u * u, 0.0, 1.0);
  float dy = q.y - arcY(q.x, t);
  float hot = exp(-u * u / 0.1);
  float reach = span * sqrt(span);
  float w = max(mix(0.006, 0.015, sqrt(span)) * (0.85 + 0.3 * hot), 0.8 * pxq);
  vec3 core = silkLine(dy, w, 0.28 * w) * (0.5 * reach + 1.3 * hot);
  float bloom = gauss(dy, 0.0, 0.04 + 0.03 * hot) * (0.36 * hot + 0.07 * reach);
  float haze = gauss(dy, 0.0, 0.14) * reach * 0.06;
  vec3 light = SILK * (core + bloom) + vec3(0.86, 0.9, 1.0) * haze;
  float shadow = gauss(dy + 0.04 + w, 0.0, 0.035 + 0.02 * hot) * (0.7 * hot + 0.25 * reach);
  return vec4(light, shadow);
}

// A ribbon of light whose cross-section twists along its length. H is its
// half-height at the widest; at H = 0 it collapses onto the resting arc.
//   len   half-length (the ribbon tapers to points at +/- len)
//   twist rotations along the length; spin and phase animate the twist
vec4 silkRibbon(vec2 q, float t, float H, float len, float twist, float spin, float phase, float yOff, float pxq) {
  float x = q.x / len;
  float taper = clamp(1.0 - x * x, 0.0, 1.0);
  float env = taper * sqrt(taper);
  float c = arcY(q.x, t) + yOff + 0.05 * H * sin(2.1 * x + 0.8 * t + phase) * env;
  float theta = phase + twist * x + spin * t + 0.45 * sin(0.37 * t + phase);
  float ct = cos(theta);
  float h = H * env;
  float lo = c - h * abs(ct);
  float hi = c + h * abs(ct);

  // Translucent body: a thin emitting sheet looks brighter seen edge-on.
  float soft = 0.006 + 0.004 * (1.0 - env) + pxq;
  float inside = smoothstep(lo - soft, lo + soft, q.y) * (1.0 - smoothstep(hi - soft, hi + soft, q.y));
  float facing = max(abs(ct), 0.14);
  float body = inside * env * clamp(0.24 / facing, 0.25, 1.6) * 0.95;

  // Bright silk edges; colour only splits off on their outer sides.
  float w = max(0.006 + 0.009 * env, 0.8 * pxq);
  vec3 edges = (silkLine(q.y - hi, w, 0.4 * w) + silkLine(q.y - lo, w, 0.4 * w)) * env * 0.7;

  float shadow = gauss(q.y - lo + 0.035, 0.0, 0.03) * env + body * 0.2;
  return vec4(SILK * (body + edges), shadow);
}

vec4 lightField(vec2 q, float t, float pxq) {
  float lv = uLevel;
  vec4 bd = uBands;
  // The ribbons open up and twist only while listening or speaking, with the voice.
  float act = uListen * (1.0 - uThinking) * smoothstep(0.03, 0.6, lv + 0.15 * bd.x);

  vec4 F = restingArc(q, t, pxq) * (0.9 + 0.8 * lv) * (1.0 - 0.4 * act);

  if (act > 0.002) {
    float H = act * (0.1 + 0.12 * bd.x + 0.06 * bd.y);
    float spin = 0.45 + 0.6 * act + 0.5 * bd.w;
    float twist = act * (0.9 + 0.8 * bd.z);
    float len = 0.76 + 0.08 * lv;
    F += silkRibbon(q, t, H, len, 2.4 * twist, spin, 0.0, 0.0, pxq) * act;
    F += silkRibbon(q, t * 1.13, H * 0.78, len * 0.92, -1.9 * twist, spin * 0.9, 2.1, -0.008, pxq) * (0.6 * act);
    F += silkRibbon(q, t * 0.87, H * 1.15, len * 1.04, 1.3 * twist, spin * 0.7, 4.0, 0.006, pxq) * (0.18 * act);
  }

  // Halation and a soft volumetric fan grow with the voice.
  float heartX = 0.05 * sin(0.41 * t + 0.7);
  float yC = arcY(heartX, t);
  float hx = (q.x - heartX) / (0.4 + 0.15 * lv);
  float hy = (q.y - yC) / (0.08 + 0.14 * act);
  float halation = exp(-(hx * hx + hy * hy)) * (0.05 + 0.3 * lv * act + 0.3 * uEnergy);
  F.rgb += mix(vec3(0.6, 0.72, 1.0), vec3(1.0, 0.82, 0.65), smoothstep(-0.06, 0.06, q.y - yC)) * halation;
  float fan = gauss(q.x, heartX, 0.3 + 0.12 * lv) * exp(-abs(q.y - yC) / (0.18 + 0.16 * lv));
  F.rgb += vec3(0.84, 0.88, 1.0) * fan * (0.25 * act * lv + 0.12 * uEnergy);
  return F;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec2 q = p / uRadius;
  float pxq = uPx / uRadius;  // one device pixel, in sphere radii
  float r2 = dot(q, q);
  float r = sqrt(r2);
  float inside = 1.0 - smoothstep(1.0 - 1.25 * pxq, 1.0 + 1.25 * pxq, r);
  float z = sqrt(max(1.0 - r2, 0.0));
  float lv = uLevel;

  // Lensing: the glass gently magnifies the light suspended at its centre.
  vec2 wq = q * mix(1.0, 0.88, z);
  wq.x *= 1.0 + 0.08 * pow(1.0 - z, 2.4);

  // Entrance: the light blooms outward from the centre as the orb wakes.
  float introEase = 1.0 - pow(1.0 - uIntro, 3.0);
  vec2 lq = vec2(wq.x / mix(0.12, 1.0, introEase), wq.y);
  vec4 field = lightField(lq, uTime, pxq) * (smoothstep(0.0, 0.7, uIntro) * inside);

  // Thinking: a comet circles just inside the rim (loading indicator).
  float ang = atan(q.y, q.x);
  float fromHead = mod(ang - uSpin + PI, 2.0 * PI) - PI;
  float tail = smoothstep(-2.6, 0.0, fromHead) * (1.0 - smoothstep(0.0, 0.08, fromHead));
  float head = exp(-pow(fromHead / 0.16, 2.0));
  vec3 cometColor = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.8, 0.6), smoothstep(-2.4, -0.6, fromHead));
  cometColor = mix(cometColor, SILK, head * 0.85);
  float cometBand = exp(-pow((r - 0.85) / (0.022 + 0.012 * head), 2.0));
  float comet = cometBand * (tail * tail * tail * 0.9 + head * 0.6) * uThinking * inside;

  // Wake: two soft rings expand through the glass.
  float ripple = 0.0;
  for (int i = 0; i < 2; i++) {
    float rp = uRipple - float(i) * 0.16;
    if (rp > 0.0 && rp < 1.0) {
      float pos = mix(0.22, 0.98, rp);
      float width = 0.07 + 0.07 * rp;
      ripple += exp(-pow((r - pos) / width, 2.0)) * smoothstep(0.0, 0.2, rp) * pow(1.0 - rp, 2.0) * (0.24 - 0.09 * float(i));
    }
  }
  ripple *= inside;

  vec3 Lt = 1.0 - exp(-field.rgb * (1.0 + 0.7 * uEnergy));  // soft saturation: overlaps glow white
  float pulse = uListen * ((0.5 + 0.5 * sin(uTime * 2.3)) * 0.5 + lv * 0.6);

  // --- Glass, shared by both looks -------------------------------------------
  float lower = smoothstep(0.05, -0.95, q.y);      // lower half only: the top stays clear
  float bottom = smoothstep(-0.3, -0.95, q.y);
  float fresnel = smoothstep(0.93, 0.995, r);      // rises only in the outer ~7% of the radius
  // Dispersion: a 1-2 px RGB split, strongest at the left and right, fading at top and bottom.
  float side = smoothstep(0.3, 0.92, abs(q.x));
  float dir = q.x < 0.0 ? -1.0 : 1.0;
  float split = 1.5 * pxq * side;
  float r0 = 1.0 - 1.4 * pxq;
  float wRim = 1.1 * pxq + 0.002;
  float rimR = gauss(r, r0 - dir * split, wRim);   // outermost on the left: warm fringe
  float rimG = gauss(r, r0, wRim);
  float rimB = gauss(r, r0 + dir * split, wRim);   // outermost on the right: blue fringe
  float rimMask = 1.0 - smoothstep(1.0 + 0.5 * pxq, 1.0 + 3.0 * pxq, r);
  // Where the arc's ends meet the glass, the rim catches its light.
  float rimArc = fresnel * gauss(q.y - ARC_Y, 0.0, 0.17) * side * inside;
  // Soft specular highlight hugging the curve at the top left.
  float toKey = mod(ang - 2.25 + PI, 2.0 * PI) - PI;
  float spec = gauss(r, 0.83, 0.1) * exp(-toKey * toKey / 0.28) * inside;

  // --- Dark glass: only ever adds light (screen blending) ---------------------
  vec3 E = vec3(0.025 + 0.035 * smoothstep(0.55, 1.0, r) + 0.065 * lower * (0.55 + 0.45 * r)) * inside;
  E += vec3(0.94, 0.96, 1.0) * gauss(r, 0.955, 0.04) * bottom * 0.4 * inside;  // crescent along the bottom
  E += vec3(fresnel * fresnel * (0.06 + 0.12 * side + 0.22 * bottom)) * inside;
  E += vec3(rimR, rimG, rimB) * (0.14 + 0.42 * side + 0.55 * bottom + 0.25 * pulse) * rimMask;
  E += SILK * rimArc * (0.5 + 0.7 * lv);
  E += vec3(spec * 0.2);
  E += Lt + cometColor * comet + vec3(0.9, 0.94, 1.0) * ripple;
  float halo = exp(-max(r - 1.0, 0.0) * 9.0) * (1.0 - inside);
  E += vec3(0.84, 0.88, 1.0) * halo * uGlow * (0.04 + 0.12 * lv * uListen + 0.04 * pulse + 0.1 * uEnergy);
  E = min(E, vec3(1.0));
  // Alpha = the grey part of the light: white composites as screen, colour adds.
  vec4 dark = vec4(E, min(E.r, min(E.g, E.b)));

  // --- Light glass: normal "over" blending, never additive --------------------
  vec4 C = vec4(0.0);
  // Soft drop shadow beneath the sphere.
  float sd = length(vec2(q.x, (q.y + 0.1) * 1.08));
  C = over(C, vec3(0.0), 0.08 * (1.0 - smoothstep(0.84, 1.3, sd)) * (1.0 - inside));
  // Faint cool tint, denser toward the rim; grey haze below; a darker refraction band.
  C = over(C, vec3(0.80, 0.86, 0.95), (0.03 + 0.05 * smoothstep(0.5, 1.0, r)) * inside);
  C = over(C, vec3(0.40, 0.44, 0.52), (0.035 * lower + 0.1 * gauss(r, 0.8, 0.1) * bottom) * inside);
  // The streak's soft grey shadow, then the white light with colour only at its edges.
  C = over(C, vec3(0.32, 0.35, 0.42), min(field.a * 0.36, 0.34));
  float luma = dot(Lt, vec3(0.299, 0.587, 0.114));
  C = over(C, vec3(1.0), smoothstep(0.02, 0.5, luma) * 0.94);
  vec3 chroma = Lt - vec3(luma);
  C = over(C, clamp(vec3(0.6) + chroma * 2.4, 0.0, 1.0), clamp(length(chroma) * 1.1, 0.0, 0.28));
  // The thinking comet and the wake rings read as silver.
  C = over(C, vec3(0.55, 0.6, 0.7), clamp(comet * 0.75 + ripple * 0.6, 0.0, 0.8));
  // Thin silver rim, 10-20% black. Darkening inverts the fringe colours, so the
  // split is mirrored: removing blue on the left reads warm, red on the right blue.
  vec3 dk = (vec3(rimB, rimG, rimR) * 0.17 + vec3(fresnel * fresnel * 0.05)) * rimMask;
  float ak = max(dk.r, max(dk.g, dk.b));
  C = vec4(vec3(ak) - dk + C.rgb * (1.0 - ak), ak + C.a * (1.0 - ak));
  // A 1 px white highlight just inside the rim, and the soft specular at the top left.
  C = over(C, vec3(1.0), gauss(r, 1.0 - 3.0 * pxq, 0.75 * pxq) * 0.85 * inside);
  C = over(C, vec3(1.0), spec * 0.55);

  // The glass fades in quickly on entrance; the light follows.
  vec4 col = mix(C, dark, uDark) * smoothstep(0.0, 0.45, uIntro);
  gl_FragColor = vec4(min(col.rgb, vec3(1.0)), clamp(col.a, 0.0, 1.0));
}
`
