/* Five deep-space worlds — STRICT 3D.
   No sprites, no canvas gradients, no billboards.
   Every element is real geometry, a real texture map (NASA-derived), a raymarched
   volumetric shader, or a GPU particle field with true 3D positions. */
import * as THREE from 'three';

export const WORLDS = [
  { key: 'nebula-drift', name: 'NEBULA DRIFT', hotkey: '1' },
  { key: 'red-planet', name: 'RED PLANET', hotkey: '2' },
  { key: 'derelict-station', name: 'DERELICT STATION', hotkey: '3' },
  { key: 'asteroid-earth', name: 'EARTHVIEW', hotkey: '4' },
  { key: 'dying-star', name: 'DYING STAR', hotkey: '5' },
];

/* ------------------------------------------------------------------ */
/* WORLD EDITOR params — density scales particle counts at build time,
   motion multiplies animation speed, hueShift rotates the palette.     */
export const DEFAULT_WORLD_PARAMS = { hueShift: 0, density: 1, motion: 1 };

let DENSITY = 1; // module-scoped build-time factor, set per buildWorld call

function scaled(n) { return Math.max(6, Math.round(n * DENSITY)); }

/* HSL-rotate a THREE.Color in place */
function hueRotate(color, deg) {
  if (!deg) return;
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL((hsl.h + deg / 360 + 1) % 1, hsl.s, hsl.l);
}

/* ------------------------------------------------------------------ */
/* texture cache                                                        */
const texLoader = new THREE.TextureLoader();
const texCache = {};
function tex(path, srgb = true) {
  if (!texCache[path]) {
    const t = texLoader.load(path);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    texCache[path] = t;
  }
  return texCache[path];
}

/* ------------------------------------------------------------------ */
/* REAL SKY (recording-fix Phase 4) — an actual photograph of the Milky Way
   (ESO eso0932a all-sky panorama, CC BY 4.0 — credits in
   public/textures/real/CREDITS.txt) on an inside-out sphere. This is what
   kills the "fake 2D shader sky" read: the backdrop has the structure,
   grain and dynamic range only a real exposure has. Per-world tint +
   exposure keep each world's palette; fog is excluded (a sky at optical
   infinity cannot be fogged); the material's .color means the WORLD
   EDITOR's hueShift traverse keeps working on it untouched. */
function photoSky(url, { tint = 0xffffff, exposure = 1 } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex(url),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    color: new THREE.Color(tint).multiplyScalar(exposure),
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 32), mat);
  mesh.scale.x = -1; // inside-out equirect reads un-mirrored
  mesh.rotation.y = Math.PI * 0.35; // frame the galactic core off-axis
  mesh.renderOrder = -100; // always behind everything, including the star dome
  return mesh;
}

/* flat telescope frames (Carina, Eagle Spire — NOT equirects) as large
   distant CURVED BACKDROPS: a partial sphere segment, additive-blended so
   their black frame edges dissolve into the photo sky behind them. Never a
   full sphere — stretching a flat frame around 360° is exactly the fake
   look this phase removes. */
function photoBackdrop(url, { tint = 0xffffff, intensity = 1, phi = 1.8, theta = 1.2, yaw = 0, pitch = 0 } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex(url),
    side: THREE.BackSide,
    fog: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: new THREE.Color(tint).multiplyScalar(intensity),
  });
  const geo = new THREE.SphereGeometry(135, 32, 24, -phi / 2, phi, Math.PI / 2 - theta / 2, theta);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.x = -1;
  mesh.rotation.set(pitch, yaw, 0);
  mesh.renderOrder = -90;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* GPU star dome — real 3D shell of round, twinkling shader points     */
function starDome(count = 8200, radius = 90) {
  count = scaled(count);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const attr = new Float32Array(count * 2); // size, twinkle phase
  const c = new THREE.Color();
  const bandNormal = new THREE.Vector3(0.35, 1, 0.2).normalize(); // tilted galactic plane
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection();
    // ~40% of stars condense into a tilted milky-way band across the dome
    if (i < count * 0.4) {
      const d = v.dot(bandNormal);
      v.addScaledVector(bandNormal, -d * 0.86).normalize();
    }
    v.multiplyScalar(radius * (0.75 + Math.random() * 0.25));
    pos.set([v.x, v.y, v.z], i * 3);
    const k = Math.random();
    if (k > 0.97) c.setHSL(0.08, 0.7, 0.75);       // orange giants
    else if (k > 0.93) c.setHSL(0.6, 0.6, 0.8);    // blue-white
    else c.setHSL(0.62, 0.08, 0.55 + Math.random() * 0.4);
    col.set([c.r, c.g, c.b], i * 3);
    attr.set([Math.random() < 0.06 ? 2.2 + Math.random() * 2 : 0.7 + Math.random() * 1.1, Math.random() * 6.28], i * 2);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aStar', new THREE.BufferAttribute(attr, 2));
  const mat = new THREE.ShaderMaterial({
    /* RECOVERY 1.2 #4 — in a real exposure, stars near a bright body are
       swallowed by glare and scattered light. uSunDir/uSunFade fade the dome
       toward any sun the active world declares. */
    uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunFade: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec2 aStar; varying vec3 vC; varying float vTw;
      uniform float uTime; uniform vec3 uSunDir; uniform float uSunFade;
      void main(){
        vC = color;
        vTw = 0.75 + 0.25 * sin(uTime * (1.5 + aStar.y) + aStar.y * 7.0);
        // glare occlusion: stars vanish inside the sun's scattered-light cone
        float glare = pow(max(dot(normalize(position), uSunDir), 0.0), 6.0);
        vTw *= 1.0 - clamp(glare * uSunFade, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aStar.x * 220.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vTw;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vC * vTw, a);
      }`,
    vertexColors: true,
  });
  return new THREE.Points(geo, mat);
}

/* ------------------------------------------------------------------ */
/* raymarched volumetric nebula — inverted dome, true 3D FBM volume    */
/* RETAINED (recording-fix Phase 4): no world calls this anymore — every sky
   is a real exposure now — but the raymarcher stays for the WORLD EDITOR's
   future custom-world path. */
// eslint-disable-next-line no-unused-vars
function nebulaVolume(cA, cB, cC, density = 1.0, radius = 70) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(cA) },
      uColB: { value: new THREE.Color(cB) },
      uColC: { value: new THREE.Color(cC) },
      uDensity: { value: density },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColA, uColB, uColC; uniform float uDensity;
      varying vec3 vWorld;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec3(1.7); a *= 0.5; }
        return v;
      }
      /* RECOVERY v2 #4 — gradient math in OKLab, not sRGB/linear-RGB.
         RGB interpolation between saturated hues passes through gray mud;
         OKLab keeps perceived lightness and chroma steady across the blend,
         which is why real emission nebulas never look muddy mid-gradient. */
      vec3 rgb2oklab(vec3 c){
        float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
        float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
        float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
        l = pow(max(l, 0.0), 1.0 / 3.0); m = pow(max(m, 0.0), 1.0 / 3.0); s = pow(max(s, 0.0), 1.0 / 3.0);
        return vec3(
          0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
      }
      vec3 oklab2rgb(vec3 c){
        float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
        float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
        float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
        l = l * l * l; m = m * m * m; s = s * s * s;
        return vec3(
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
      }
      vec3 mixOklab(vec3 a, vec3 b, float t){
        return max(vec3(0.0), oklab2rgb(mix(rgb2oklab(a), rgb2oklab(b), t)));
      }
      void main(){
        vec3 rd = normalize(vWorld - cameraPosition);
        // march through a virtual volume along the view ray
        vec3 col = vec3(0.0);
        float trans = 1.0;
        float t = 8.0;
        // higher-fidelity march: more, finer steps + self-shadow density lift
        for (int i = 0; i < 30; i++){
          vec3 p = cameraPosition + rd * t;
          vec3 q = p * 0.045 + vec3(uTime * 0.008, 0.0, uTime * 0.005);
          float d = fbm(q);
          d = smoothstep(0.42, 0.75, d) * uDensity;
          if (d > 0.001) {
            float hue = fbm(q * 0.5 + 3.7);
        vec3 c = mixOklab(uColA, uColB, smoothstep(0.3, 0.7, hue));
        c = mixOklab(c, uColC, smoothstep(0.55, 0.9, fbm(q * 0.25 - 1.3)));
            // cheap self-shadowing: denser clouds glow hotter at their cores
            c *= 0.75 + d * 0.65;
            // embedded newborn stars flare inside the densest knots
            float knot = smoothstep(0.86, 0.99, d / max(uDensity, 0.001));
            c += vec3(1.2, 1.05, 0.9) * knot * (0.6 + 0.4 * sin(uTime * 2.0 + hue * 40.0));
            float a = d * 0.10;
            col += c * a * trans;
            trans *= 1.0 - a;
            if (trans < 0.04) break;
          }
          t += 1.9;
        }
        // keep the zenith darker so the subject reads
        float horizon = smoothstep(-0.15, 0.55, rd.y);
        col *= mix(1.0, 0.45, horizon);
        gl_FragColor = vec4(col, 1.0 - trans);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), mat);
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* distant spiral galaxy — a real shader disk, tilted in true 3D       */
function spiralGalaxy(radius, cCore, cArm) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new THREE.Color(cCore) },
      uArm: { value: new THREE.Color(cArm) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uCore, uArm;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 x){
        vec2 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      void main(){
        float r = length(vUv) * 2.0;
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x);
        // two logarithmic arms winding out of the core, slowly rotating
        float swirl = ang + 5.2 * log(max(r, 0.03)) + uTime * 0.01;
        float arms = pow(abs(cos(swirl)), 2.2);
        float grain = noise(vUv * 40.0 + uTime * 0.02) * 0.4 + 0.6;
        float core = exp(-r * 5.5) * 2.2;
        float disk = exp(-r * 2.4) * (0.25 + arms * 0.75) * grain;
        vec3 col = uCore * core + uArm * disk;
        float a = clamp(core + disk, 0.0, 1.0) * smoothstep(1.0, 0.82, r);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), mat);
  return mesh;
}

/* GPU shooting stars — each meteor is a trail of points streaking the dome */
function meteorShower(meteors = 5, trail = 16) {
  meteors = Math.max(2, Math.round(meteors * DENSITY));
  const count = meteors * trail;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);      // start position on the dome
  const dir = new Float32Array(count * 3);      // streak direction
  const info = new Float32Array(count * 3);     // meteor phase, trail index 0..1, speed
  for (let m = 0; m < meteors; m++) {
    const start = new THREE.Vector3().randomDirection().multiplyScalar(70);
    start.y = Math.abs(start.y) * 0.7 + 12;     // always overhead
    const d = new THREE.Vector3((Math.random() - 0.5), -0.5 - Math.random() * 0.4, (Math.random() - 0.5)).normalize();
    for (let i = 0; i < trail; i++) {
      const idx = m * trail + i;
      pos.set([start.x, start.y, start.z], idx * 3);
      dir.set([d.x, d.y, d.z], idx * 3);
      info.set([m * 1.618, i / trail, 22 + Math.random() * 8], idx * 3);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 aDir; attribute vec3 aInfo;
      uniform float uTime; varying float vA;
      void main(){
        // each meteor lives on a long cycle: a short brilliant streak, then darkness
        float cycle = 9.0 + aInfo.x * 2.7;
        float t = mod(uTime + aInfo.x * 13.7, cycle);
        float life = 1.6;
        float lt = clamp(t / life, 0.0, 1.0);
        float dist = lt * aInfo.z - aInfo.y * 3.2;     // trail lags the head
        vec3 p = position + aDir * dist;
        float alive = step(t, life) * step(0.0, dist);
        vA = alive * (1.0 - aInfo.y) * (1.0 - lt) * 1.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.0 - aInfo.y * 0.8) * 160.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.88), a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/* ------------------------------------------------------------------ */
/* BLACK-BODY STAR — RECOVERY 1.2 #3.
   No arbitrary palette: the surface color comes from Planck's law. FBM
   granulation modulates the local TEMPERATURE (Kelvin), and the black-body
   approximation converts temperature to color — so hot knots go white-blue and
   cool lanes go deep red exactly the way real photospheres do. Limb darkening
   (mu = cos of the view angle) darkens the edge like every real star photo.
   Emissive is pushed hard (x3.2) so ACES tonemapping cannot gray it out.      */
function plasmaStar(radius, tempK = 5700, intensity = 3.2) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTemp: { value: tempK },
      uInt: { value: intensity },
      uTint: { value: new THREE.Color(0xffffff) }, // hueShift hook
    },
    vertexShader: `
      varying vec3 vPos; varying vec3 vNv;
      void main(){
        vPos = position;
        vNv = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uTemp; uniform float uInt; uniform vec3 uTint;
      varying vec3 vPos; varying vec3 vNv;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.1 + vec3(1.3); a *= 0.5; }
        return v;
      }
      /* Planckian locus approximation: temperature (K) -> normalized RGB */
      vec3 blackbody(float T){
        float t = clamp(T, 1000.0, 40000.0) / 100.0;
        float r = t <= 66.0 ? 1.0 : clamp(1.2929 * pow(t - 60.0, -0.1332), 0.0, 1.0);
        float g = t <= 66.0 ? clamp(0.39008 * log(t) - 0.63184, 0.0, 1.0)
                            : clamp(1.1299 * pow(t - 60.0, -0.0755), 0.0, 1.0);
        float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432 * log(t - 10.0) - 1.19625, 0.0, 1.0));
        return vec3(r, g, b);
      }
      void main(){
        vec3 p = normalize(vPos);
        // granulation: convecting cells modulate LOCAL temperature, not color
        float n = fbm(p * 4.0 + vec3(uTime * 0.06, uTime * 0.04, 0.0));
        n += 0.4 * fbm(p * 11.0 - vec3(0.0, uTime * 0.12, 0.0));
        float T = uTemp * (0.82 + n * 0.42);            // cool lanes .. hot knots
        // Stefan-Boltzmann-ish: hotter cells are disproportionately brighter
        float lum = pow(T / uTemp, 4.0);
        // limb darkening: I(mu) = 1 - u(1 - mu), the signature of a real disk
        float mu = clamp(abs(vNv.z), 0.0, 1.0);
        float limb = 1.0 - 0.62 * (1.0 - mu);
        vec3 col = blackbody(T) * lum * limb * uInt * uTint;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 64), mat);
}

/* fresnel glow shell — real 3D geometry hugging a body, additive limb glow */
function fresnelShell(radius, color, power = 3.0, intensity = 1.0) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPow: { value: power }, uInt: { value: intensity } },
    vertexShader: `
      varying float vF;
      uniform float uPow;
      void main(){
        vec3 n = normalize(normalMatrix * normal);
        vec3 v = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
        vF = pow(1.0 - abs(dot(n, v)), uPow);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float vF; uniform vec3 uColor; uniform float uInt;
      void main(){ gl_FragColor = vec4(uColor * vF * uInt, vF); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
}

/* ------------------------------------------------------------------ */
/* RAYLEIGH + MIE ATMOSPHERE — RECOVERY 1.2 #3 (verified technique).
   Earth's atmosphere as a separate BackSide sphere shell with a single-
   scattering fragment shader after the Hillaire 2020 model — NOT a rim-lit
   material. Per-channel Rayleigh coefficients give the physically correct
   blue limb that whitens toward the sun; a Henyey-Greenstein Mie lobe puts
   the forward-scatter halo around the light. The march is short (12 steps)
   because the shell is thin; density falls off exponentially with height.  */
function atmosphereShell(planetR, shellR, sunDir, intensity = 1.0) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uPlanetR: { value: planetR },
      uShellR: { value: shellR },
      uInt: { value: intensity },
      uRayleigh: { value: new THREE.Color(0.18, 0.42, 1.0) }, // ∝ 1/λ⁴ (hueShift hook)
      uMie: { value: new THREE.Color(0.85, 0.82, 0.78) },
    },
    vertexShader: `
      varying vec3 vLocal;
      varying vec3 vCamLocal;
      void main(){
        vLocal = position;                      // object space: planet centre = origin
        /* modelMatrix is a VERTEX-only built-in in three.js — compute the
           camera's planet-local position here and hand it down as a varying
           (constant across the mesh, so interpolation is a no-op) */
        vCamLocal = cameraPosition - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSunDir; uniform float uPlanetR, uShellR, uInt;
      uniform vec3 uRayleigh, uMie;
      varying vec3 vLocal;
      varying vec3 vCamLocal;
      /* sphere intersection: returns (near, far) distances along ro+rd*t, or (-1,-1) */
      vec2 raySphere(vec3 ro, vec3 rd, float r){
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float h = b * b - c;
        if (h < 0.0) return vec2(-1.0);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }
      void main(){
        /* camera relative to the planet centre (from the vertex stage —
           fragment shaders have no modelMatrix built-in) */
        vec3 camLocal = vCamLocal;
        vec3 rd = normalize(vLocal - camLocal);
        vec2 shell = raySphere(camLocal, rd, uShellR);
        if (shell.y < 0.0) discard;
        float t0 = max(shell.x, 0.0);
        float t1 = shell.y;
        /* the solid planet truncates the march */
        vec2 ground = raySphere(camLocal, rd, uPlanetR);
        if (ground.x > 0.0) t1 = min(t1, ground.x);
        float H = (uShellR - uPlanetR);                 // scale height ≈ shell thickness
        float stepLen = (t1 - t0) / 12.0;
        float mu = dot(rd, uSunDir);
        /* phase functions: Rayleigh + Henyey-Greenstein Mie (g = 0.76) */
        float phR = 0.0596831 * (1.0 + mu * mu);
        float g = 0.76;
        float phM = 0.1193662 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
        vec3 sumR = vec3(0.0); float sumM = 0.0;
        float t = t0 + stepLen * 0.5;
        for (int i = 0; i < 12; i++){
          vec3 p = camLocal + rd * t;
          float h = max(0.0, length(p) - uPlanetR);
          float dR = exp(-h / (H * 0.35));              // Rayleigh: taller falloff
          float dM = exp(-h / (H * 0.12));              // Mie: hugs the surface
          /* sun visibility: night side of the shell scatters nothing */
          float sunH = dot(normalize(p), uSunDir);
          float lit = smoothstep(-0.28, 0.12, sunH);
          sumR += uRayleigh * dR * lit * stepLen;
          sumM += dM * lit * stepLen;
          t += stepLen;
        }
        vec3 col = (sumR * phR * 14.0 + uMie * sumM * phM * 5.0) * uInt / H;
        /* transmittance-ish alpha: thick slant paths read opaque at the limb */
        float a = clamp(dot(col, vec3(0.30, 0.55, 0.15)) * 1.6, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(shellR, 64, 64), mat);
  return mesh;
}

/* ------------------------------------------------------------------ */
/* instanced asteroid field — real displaced rock geometry, drifting   */
function asteroidField(count, box, scaleMin, scaleMax, color = 0x4a4550) {
  count = scaled(count);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    v.multiplyScalar(1 + (Math.random() - 0.5) * 0.55);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const data = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * box.x,
      box.yBase + Math.random() * box.y,
      -box.zBase - Math.random() * box.z
    );
    const rot = new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    const spin = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(0.35);
    const scl = scaleMin + Math.random() * (scaleMax - scaleMin);
    const driftX = (Math.random() - 0.5) * 0.12;
    data.push({ pos, rot, spin, scl, driftX, ph: Math.random() * 6.28 });
  }
  inst.userData.update = (t, dt) => {
    for (let i = 0; i < count; i++) {
      const d = data[i];
      d.rot.x += d.spin.x * dt; d.rot.y += d.spin.y * dt; d.rot.z += d.spin.z * dt;
      q.setFromEuler(d.rot);
      s.setScalar(d.scl);
      m.compose(new THREE.Vector3(d.pos.x + Math.sin(t * 0.05 + d.ph) * 0.6 + d.driftX * t % 4, d.pos.y + Math.sin(t * 0.07 + d.ph) * 0.4, d.pos.z), q, s);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  return inst;
}

/* volumetric dust motes with true 3D positions (round shader points) */
function dustPoints(count, spread, color, size = 0.03) {
  count = scaled(count);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos.set([(Math.random() - 0.5) * spread, Math.random() * 4 - 0.5, (Math.random() - 0.5) * spread], i * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uSize: { value: size } },
    vertexShader: `
      uniform float uTime; uniform float uSize;
      void main(){
        vec3 p = position;
        p.y += sin(uTime * 0.3 + position.x * 3.0) * 0.15;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * 900.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * 0.5;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  return new THREE.Points(geo, mat);
}

/* displaced FBM terrain mesh (real geometry, not a texture trick) */
function terrain(width, depth, segs, ampl, colorMap) {
  const geo = new THREE.PlaneGeometry(width, depth, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const n2 = (x, z) => {
    let v = 0, a = 1, f = 1;
    for (let o = 0; o < 4; o++) {
      v += a * (Math.sin(x * 0.7 * f + o * 12.3) * Math.cos(z * 0.53 * f - o * 7.1));
      a *= 0.5; f *= 2.1;
    }
    return v;
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const dist = Math.sqrt(x * x + z * z);
    const h = n2(x * 0.35, z * 0.35) * ampl * Math.min(1, dist / 8); // flat near player
    p.setY(i, h);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: colorMap, roughness: 1, metalness: 0 });
  if (colorMap) { colorMap.wrapS = colorMap.wrapT = THREE.RepeatWrapping; colorMap.repeat.set(4, 4); }
  return new THREE.Mesh(geo, mat);
}

/* ------------------------------------------------------------------ */
export function buildWorld(scene, key, params) {
  const p = { ...DEFAULT_WORLD_PARAMS, ...(params || {}) };
  DENSITY = Math.max(0.4, Math.min(1.6, p.density || 1));
  const motion = Math.max(0.2, Math.min(2.5, p.motion || 1));
  const hueShift = p.hueShift || 0;
  const group = new THREE.Group();
  const updaters = [];
  const timeMats = []; // materials with uTime
  /* DEMOTED (recording-fix Phase 4): with a real photographed sky carrying
     the star field, the procedural dome becomes a sparse foreground twinkle
     layer — it adds the live shimmer a static photo can't, without fighting
     the photo's own stars. */
  const stars = starDome(2800);
  group.add(stars);
  timeMats.push(stars.material);
  updaters.push((t) => { stars.rotation.y = t * 0.003; });
  /* the real Milky Way behind every world, drifting imperceptibly so even a
     locked-off shot never reads as a still image */
  const addSky = (opts) => {
    const sky = photoSky('/textures/real/milkyway_4k.jpg', opts);
    group.add(sky);
    const yaw0 = sky.rotation.y;
    updaters.push((t) => { sky.rotation.y = yaw0 + t * 0.0015; });
    return sky;
  };
  // occasional meteors streak the dome in every world
  const meteors = meteorShower();
  group.add(meteors);
  timeMats.push(meteors.material);
  let fogColor = 0x02020a;
  let fogDensity = 0.012;
  const lights = [];

  const addTimeMat = (obj) => { timeMats.push(obj.material); return obj; };

  /* RECOVERY 1.2 #4 — glare occlusion: aim the star dome's fade cone at the
     world's brightest body. Real stars vanish inside a sun's scattered light;
     a dome that ignores its sun is a screensaver. fade 0 = untouched night sky. */
  const sunGlare = (pos, fade) => {
    stars.material.uniforms.uSunDir.value.copy(pos).normalize();
    stars.material.uniforms.uSunFade.value = fade;
  };

  if (key === 'nebula-drift') {
    scene.background = new THREE.Color(0x020112); // load fallback behind the photo sky
    fogColor = 0x0a0620;
    addSky({ tint: 0xcdbcff, exposure: 1.0 });
    /* the FBM raymarch is GONE here (recording-fix Phase 4) — replaced by the
       real thing: ESO's VLT infrared exposure of the Carina nebula as a
       curved distant backdrop, tinted into the world's violet palette */
    const carina = photoBackdrop('/textures/real/carina_ir_2k.jpg', {
      tint: 0xd9c2ff, intensity: 1.2, yaw: -0.45, pitch: -0.1, phi: 2.0, theta: 1.3,
    });
    group.add(carina);
    updaters.push((t) => { carina.rotation.y = -0.45 + t * 0.002; });
    // a distant spiral galaxy tilted into the deep field
    const gal = addTimeMat(spiralGalaxy(18, 0xfff0dd, 0x8866ff));
    gal.position.set(-16, 18, -60);
    gal.rotation.set(1.15, 0.2, 0.4);
    group.add(gal);
    // drifting rock silhouettes catching purple light — real geometry with parallax
    const rocks = asteroidField(26, { x: 40, y: 16, yBase: -4, zBase: 14, z: 30 }, 0.4, 2.2, 0x241f30);
    group.add(rocks);
    updaters.push((t, dt) => rocks.userData.update(t, dt));
    const dust = addTimeMat(dustPoints(320, 9, 0x9977ff, 0.026));
    group.add(dust);
    updaters.push((t) => { dust.rotation.y = t * 0.02; });
    lights.push(new THREE.PointLight(0x8844ff, 40, 50)); lights[0].position.set(-5, 5, -8);
    lights.push(new THREE.PointLight(0xd42a55, 24, 40)); lights[1].position.set(7, 2, -14);
  } else if (key === 'red-planet') {
    scene.background = new THREE.Color(0x180602);
    fogColor = 0x2a0d05; fogDensity = 0.02;
    /* recording-fix Phase 4 — photo sky only: the real Milky Way pushed warm
       and dim, as it reads through Mars's dusty night haze. The fog owns the
       horizon; the photo owns the zenith. */
    addSky({ tint: 0xffc9a6, exposure: 0.5 });
    // real displaced martian terrain with real Mars albedo
    const ground = terrain(90, 90, 96, 1.6, tex('/textures/mars_2k.jpg'));
    ground.position.y = -1.55; group.add(ground);
    // sun: black-body photosphere (5700K, G-type) + fresnel corona shell
    const sun = addTimeMat(plasmaStar(2.6, 5700, 3.2));
    sun.position.set(9, 8, -38); group.add(sun);
    const corona = addTimeMat(fresnelShell(4.4, 0xff9944, 2.2, 2.4));
    corona.position.copy(sun.position); group.add(corona);
    sunGlare(sun.position, 1.0);   // stars drown in the sun's scattered light
    // Phobos — real moon texture, irregular scale
    const phobos = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 32), new THREE.MeshStandardMaterial({ map: tex('/textures/moon_1024.jpg'), roughness: 1, color: 0xaa8877 }));
    phobos.scale.set(1.2, 0.9, 1); phobos.position.set(-8, 10, -30); group.add(phobos);
    updaters.push((t) => { phobos.rotation.y = t * 0.05; phobos.position.x = -8 + Math.sin(t * 0.02) * 2; });
    // wind-blown dust
    const dust = addTimeMat(dustPoints(500, 14, 0xcc7744, 0.02));
    group.add(dust);
    updaters.push((t) => { dust.position.x = ((t * 0.7) % 20) - 10; });
    lights.push(new THREE.DirectionalLight(0xffbb88, 2.2)); lights[0].position.set(8, 8, -8);
    lights.push(new THREE.HemisphereLight(0xcc6633, 0x1a0603, 0.7));
  } else if (key === 'derelict-station') {
    scene.background = new THREE.Color(0x020306);
    fogColor = 0x050810;
    /* recording-fix Phase 4 — the procedural FBM nebula is GONE: the real
       Milky Way (cooled into the wreck's palette) carries the sky, and
       Hubble's Eagle "Spire" exposure hangs behind the station as a curved
       distant backdrop — cold pillar structure no raymarch can fake. */
    addSky({ tint: 0xaac4ee, exposure: 0.78 });
    const spire = photoBackdrop('/textures/real/eagle_spire_2k.jpg', {
      tint: 0x9fc4ff, intensity: 1.05, yaw: 0.55, pitch: -0.06, phi: 1.7, theta: 1.25,
    });
    group.add(spire);
    updaters.push((t) => { spire.rotation.y = 0.55 + t * 0.0018; });
    // wrecked truss cage — real geometry
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a3448, roughness: 0.5, metalness: 0.85 });
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 12, 0.4), beamMat);
      beam.position.set(i * 2.6, 3, -5 - Math.abs(i) * 1.4);
      beam.rotation.z = i * 0.06; group.add(beam);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(12, 0.22, 0.35), beamMat);
      cross.position.set(0, 1.2 + i * 2.1, -5.6); group.add(cross);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x77d5ff }));
      strip.position.set(0, 1.34 + i * 2.1, -5.55); group.add(strip);
    }
    // rotating station ring with spokes — real geometry
    const station = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.5, 12, 80), new THREE.MeshStandardMaterial({ color: 0x232e40, roughness: 0.55, metalness: 0.9 }));
    station.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.4, 24), ring.material);
    hub.rotation.x = Math.PI / 2; station.add(hub);
    for (let s = 0; s < 4; s++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 17.4, 8), ring.material);
      spoke.rotation.z = s * Math.PI / 4; station.add(spoke);
    }
    // lit windows around the ring — tiny emissive boxes
    for (let w = 0; w < 40; w++) {
      const a = (w / 40) * Math.PI * 2;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: Math.random() > 0.3 ? 0xaaddff : 0xff8833 }));
      win.position.set(Math.cos(a) * 9, Math.sin(a) * 9, 0.52); station.add(win);
    }
    station.position.set(4, 5, -26); station.rotation.x = 1.1; group.add(station);
    updaters.push((t) => { station.rotation.z = t * 0.05; });
    // tumbling debris — instanced 3D
    const debris = asteroidField(30, { x: 30, y: 14, yBase: -2, zBase: 10, z: 26 }, 0.15, 0.8, 0x394252);
    group.add(debris);
    updaters.push((t, dt) => debris.userData.update(t, dt));
    const flicker = new THREE.PointLight(0x66ddff, 34, 30); flicker.position.set(-3, 4, -2); group.add(flicker);
    updaters.push((t) => { flicker.intensity = (Math.sin(t * 17) > 0.94 || Math.sin(t * 7.3) > 0.98) ? 6 : 30 + Math.sin(t * 2) * 6; });
    const warn = new THREE.PointLight(0xff3322, 22, 18); warn.position.set(4, 2.5, -4); group.add(warn);
    updaters.push((t) => { warn.intensity = 12 + 12 * Math.max(0, Math.sin(t * 1.4)); });
    lights.push(new THREE.DirectionalLight(0x5588bb, 0.8)); lights[0].position.set(-4, 8, 6);
  } else if (key === 'asteroid-earth') {
    scene.background = new THREE.Color(0x010208);
    fogColor = 0x030512; fogDensity = 0.008;
    /* recording-fix Phase 4 — photo sky only: orbital footage's backdrop IS
       the raw Milky Way, near-neutral, at full exposure. */
    addSky({ tint: 0xc8d4f2, exposure: 0.92 });
    // REAL Earth: NASA albedo + normal + specular, separate rotating cloud sphere,
    // fresnel atmosphere shell. All true 3D.
    const earth = new THREE.Mesh(new THREE.SphereGeometry(5.2, 64, 64), new THREE.MeshPhongMaterial({
      map: tex('/textures/earth_atmos_2048.jpg'),
      normalMap: tex('/textures/earth_normal_2048.jpg', false),
      normalScale: new THREE.Vector2(0.8, 0.8),
      specularMap: tex('/textures/earth_specular_2048.jpg', false),
      specular: new THREE.Color(0x333333),
      shininess: 18,
    }));
    earth.position.set(-2.6, 7.6, -22); group.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(5.28, 64, 64), new THREE.MeshLambertMaterial({
      map: tex('/textures/earth_clouds_1024.png'), transparent: true, opacity: 0.85, depthWrite: false,
    }));
    clouds.position.copy(earth.position); group.add(clouds);
    /* RECOVERY 1.2 #3 — Rayleigh + Mie scattering shell (Hillaire model), lit by
       the same key the surface sees. The blue limb IS the realism; it whitens
       toward the sun and dies on the night side, exactly like orbital footage. */
    const sunDirEarth = new THREE.Vector3(-14, 10, 6).normalize();
    const atmoShell = atmosphereShell(5.2, 5.62, sunDirEarth, 1.15);
    atmoShell.position.copy(earth.position); group.add(atmoShell);
    updaters.push((t) => { earth.rotation.y = t * 0.014; clouds.rotation.y = t * 0.019; });
    // the Moon — real texture
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 48), new THREE.MeshStandardMaterial({ map: tex('/textures/moon_1024.jpg'), roughness: 1 }));
    moon.position.set(7.5, 13, -34); group.add(moon);
    updaters.push((t) => { moon.rotation.y = t * 0.01; });
    // Andromeda hanging in the far field
    const gal = addTimeMat(spiralGalaxy(14, 0xffeedd, 0x6688ff));
    gal.position.set(14, 20, -70);
    gal.rotation.set(1.3, -0.3, 0.2);
    group.add(gal);
    // asteroid belt drifting through the foreground depth
    const belt = asteroidField(34, { x: 44, y: 20, yBase: -6, zBase: 8, z: 34 }, 0.2, 1.6, 0x4a4550);
    group.add(belt);
    updaters.push((t, dt) => belt.userData.update(t, dt));
    lights.push(new THREE.DirectionalLight(0xffffff, 2.6)); lights[0].position.set(-14, 10, 6);
    lights.push(new THREE.PointLight(0x4477ff, 14, 30)); lights[1].position.set(-2, 6, -10);
    sunGlare(sunDirEarth, 0.45);   // off-frame sun still eats the stars near its cone
  } else { // dying-star
    scene.background = new THREE.Color(0x0d0302);
    fogColor = 0x1a0503;
    /* recording-fix Phase 4 — the Milky Way scorched into embers behind the
       giant, with Hubble's visible-light Carina exposure as a distant curved
       backdrop opposite the star: the shockwave structure of a real dying
       stellar neighborhood. */
    addSky({ tint: 0xffb896, exposure: 0.6 });
    const carinaHst = photoBackdrop('/textures/real/carina_hst_2k.jpg', {
      tint: 0xffb27a, intensity: 1.1, yaw: -2.2, pitch: 0.05, phi: 1.9, theta: 1.3,
    });
    group.add(carinaHst);
    updaters.push((t) => { carinaHst.rotation.y = -2.2 + t * 0.0016; });
    // the star itself: black-body red giant (3400K — deep M-class) + two corona shells
    const star = addTimeMat(plasmaStar(7, 3400, 3.6));
    star.position.set(6, 6, -36); group.add(star);
    const corona1 = addTimeMat(fresnelShell(9.2, 0xff6622, 2.0, 2.6));
    corona1.position.copy(star.position); group.add(corona1);
    const corona2 = addTimeMat(fresnelShell(12.5, 0xff3300, 3.5, 1.2));
    corona2.position.copy(star.position); group.add(corona2);
    sunGlare(star.position, 1.25); // a giant this close owns half the sky's glare
    updaters.push((t) => {
      star.rotation.y = t * 0.02;
      corona1.scale.setScalar(1 + 0.03 * Math.sin(t * 0.9));
      corona2.scale.setScalar(1 + 0.05 * Math.sin(t * 0.6 + 1));
    });
    // scorched planet in the foreground field — real geometry, mars texture charred
    const cinder = new THREE.Mesh(new THREE.SphereGeometry(1.6, 48, 48), new THREE.MeshStandardMaterial({ map: tex('/textures/mars_2k.jpg'), color: 0x553322, roughness: 1 }));
    cinder.position.set(-7, 3, -18); group.add(cinder);
    updaters.push((t) => { cinder.rotation.y = t * 0.03; });
    // ember stream being pulled toward the star
    const embers = addTimeMat(dustPoints(450, 16, 0xff7733, 0.024));
    group.add(embers);
    updaters.push((t) => { embers.rotation.y = t * 0.05; embers.position.y = Math.sin(t * 0.3) * 0.4; });
    const rocks = asteroidField(20, { x: 36, y: 14, yBase: -4, zBase: 10, z: 24 }, 0.3, 1.4, 0x33221c);
    group.add(rocks);
    updaters.push((t, dt) => rocks.userData.update(t, dt));
    lights.push(new THREE.DirectionalLight(0xff7744, 2.6)); lights[0].position.set(6, 5, -8);
    lights.push(new THREE.HemisphereLight(0x662211, 0x0a0202, 0.5));
  }

  lights.forEach((l) => group.add(l));
  scene.fog = new THREE.FogExp2(fogColor, fogDensity);
  scene.add(group);

  /* WORLD EDITOR — hueShift rotates the whole palette after build:
     lights, standard material tints, every shader color uniform, background + fog */
  if (hueShift) {
    group.traverse((o) => {
      if (o.isLight && o.color) hueRotate(o.color, hueShift);
      if (o.isLight && o.groundColor) hueRotate(o.groundColor, hueShift);
      const m = o.material;
      if (!m) return;
      if (m.uniforms) {
        Object.values(m.uniforms).forEach((u) => { if (u.value && u.value.isColor) hueRotate(u.value, hueShift); });
      } else if (m.color) hueRotate(m.color, hueShift);
    });
    if (scene.background && scene.background.isColor) hueRotate(scene.background, hueShift);
    if (scene.fog && scene.fog.color) hueRotate(scene.fog.color, hueShift);
  }

  /* audio-reactive energy: cheap uniform/intensity nudges only, no allocations */
  const lightBase = lights.map((l) => l.intensity);
  let energy = 0;

  return {
    group,
    params: p,
    update(t, dt) {
      const mt = t * motion, mdt = dt * motion;
      timeMats.forEach((m) => { if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = mt; });
      updaters.forEach((u) => u(mt, mdt));
      for (let i = 0; i < lights.length; i++) lights[i].intensity = lightBase[i] * (1 + energy * 0.55);
    },
    setEnergy(e) { energy = Math.max(0, Math.min(1, e || 0)); },
    /* depth-parallax: counter-shift the farthest layers against head motion */
    parallax(dx, dy) {
      stars.position.x = -dx * 1.6;
      stars.position.y = dy * 0.8;
      meteors.position.x = -dx * 1.2;
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          // shared cached textures are NOT disposed — only materials
          o.material.dispose();
        }
      });
    },
  };
}
