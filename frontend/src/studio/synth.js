/* NEURAL CINEMA — Ω.3

   Rendered frames become photographed frames.

   The terminal plan is honest here and so is this file: true SD-Turbo img2img is a
   GATED upgrade (WebGPU + memory probe, weights in OPFS) and until that gate opens
   the finish must degrade to something already beautiful. This file IS that base
   layer — the deterministic photographic pass every Omega frame goes through:

     · halation          — bright emissives bleed into neighbouring film stock
     · photochemical tone — soft shoulder, lifted warm blacks, silver-retention
                            shadow desaturation (the bleach-bypass read)
     · split toning       — cool shadows / warm highlights, strength-scaled
     · film grain         — hash grain in LOG space (dense in shadows, fine in
                            highlights, like negative stock — not TV static)
     · gate weave         — sub-pixel frame float, seeded per shot

   Every uniform is a pure function of (shot time, seed, strength). Same shot +
   same seed + same strength = the same frames, forever — the direction-track
   contract that makes a synthetic frame as reproducible as a performed one.

   The pass costs one fullscreen draw. It is applied per shot, A/B-able against
   the raw render, and OFF at strength 0 (early-out in the shader). */

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const CINEMA_DEFAULT = 0.65;

const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },        // SHOT time — deterministic, never wall time
    uSeed: { value: 11 },
    uStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSeed, uStrength;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423) + uSeed);
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      if (uStrength < 0.004) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      float S = uStrength;

      /* gate weave — the frame floats in the gate, sub-pixel, seeded */
      float fr = floor(uTime * 24.0);
      vec2 weave = (vec2(hash(vec2(fr, 3.7)), hash(vec2(fr, 9.1))) - 0.5) * 0.0016 * S;
      vec2 uv = vUv + weave;

      vec3 col = texture2D(tDiffuse, uv).rgb;

      /* halation — bright energy bleeds through the stock around the frame centre
         of each highlight. Five wide taps, thresholded, warm-shifted. */
      vec3 bleed = vec3(0.0);
      const float R = 0.0085;
      bleed += texture2D(tDiffuse, uv + vec2( R,  0.0)).rgb;
      bleed += texture2D(tDiffuse, uv + vec2(-R,  0.0)).rgb;
      bleed += texture2D(tDiffuse, uv + vec2(0.0,  R * 0.56)).rgb;
      bleed += texture2D(tDiffuse, uv + vec2(0.0, -R * 0.56)).rgb;
      bleed += texture2D(tDiffuse, uv + vec2( R * 0.7, R * 0.4)).rgb;
      bleed *= 0.2;
      float hot = smoothstep(0.55, 1.0, luma(bleed));
      col += bleed * hot * vec3(0.30, 0.16, 0.10) * S;   // halation is red-biased

      /* photochemical tone — soft shoulder + lifted, slightly warm blacks */
      vec3 shouldered = col / (col + vec3(0.42));
      shouldered *= 1.42;
      col = mix(col, shouldered, 0.55 * S);
      col = mix(col, col * 0.94 + vec3(0.028, 0.024, 0.022), S * 0.6);

      /* silver retention — shadows lose chroma before highlights do */
      float L = luma(col);
      float shadow = 1.0 - smoothstep(0.0, 0.45, L);
      col = mix(col, vec3(L), shadow * 0.35 * S);

      /* split toning — cool the shadows, warm the highlights */
      col += (vec3(-0.012, 0.004, 0.030) * shadow
            + vec3(0.020, 0.008, -0.016) * smoothstep(0.5, 1.0, L)) * S;

      /* film grain in log space — dense in shadows, fine in highlights */
      float g = hash(uv * vec2(1081.0, 1921.0) + fract(uTime) * 61.7) - 0.5;
      float gAmt = mix(0.055, 0.012, smoothstep(0.05, 0.8, L));
      col += g * gAmt * S;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Build the pass. Insert between the grade and the OutputPass; drive it with
 * shot time. Returns a handle the stage exposes to the room.
 */
export function createCinema() {
  const pass = new ShaderPass(CinemaShader);
  return {
    pass,
    set strength(v) { pass.uniforms.uStrength.value = Math.max(0, Math.min(1, v)); },
    get strength() { return pass.uniforms.uStrength.value; },
    set seed(v) { pass.uniforms.uSeed.value = v || 11; },
    tick(shotTime) { pass.uniforms.uTime.value = shotTime; },
  };
}
