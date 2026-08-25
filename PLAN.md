# Recording Pipeline Fix Plan (persisted — do not resend)

## Context
A live recording test exposed three failures:
1. "First second it only zoomed me" — the door opening (MASK_SNAP) read as a plain zoom with no hook text.
2. "At the end nothing happened" — the loop seam produced no visible return to the opening composition.
3. "Captions look basic/AI, backgrounds are fake 2D" — Arial-on-small-canvas captions, fully procedural shader skies.

Confirmed decisions: hybrid real-photo sky + 3D bodies; best-in-class captions (white 900-weight caps, black outline, crimson #FF2E63 keyword, word-pop); keep the invisible loop and make it actually work.

## Root causes
- **Bug A (door "only zoomed")**: `stage.js` `burn()` used invalid canvas font shorthand (`800 condensed ...px 'Arial Narrow'`) — Chrome rejects the assignment, hook text renders at 10px sans-serif ≈ invisible. MASK_SNAP's only visible motion was a 1.05 dolly. doorCam had no roll channel.
- **Bug B (seam "nothing happened")**: Seam gated on `voice.done` which is often unconfirmed in live-mic mode; manual stop skips the seam entirely (`closeDoor() → abort()` → neutral pose captured); even when the seam ran it only lerped the camera — never re-burned the hook text or re-applied per-move actor visibility.
- **Gap C (captions)**: 800 Arial on 1024×220 canvas on a 0.34-unit plane; active word flat color swap, no animation; overlays over flat black rects.
- **Gap D (fake worlds)**: All 5 worlds (`nebula-drift, red-planet, derelict-station, asteroid-earth, dying-star`) use procedural shader skies; `scene.background` flat color.

## Assets (already committed — fonts + textures, commit c1ed49b)
`frontend/public/textures/real/`: milkyway_4k.jpg (ESO eso0932a equirect, resized 4096×2048, CC BY 4.0), carina_ir_2k.jpg (ESO VLT), carina_hst_2k.jpg (Hubble), eagle_spire_2k.jpg (Hubble), CREDITS.txt (mandatory attributions).
`frontend/public/fonts/`: montserrat-800.woff2, montserrat-900.woff2 (~25KB subsets, OFL).
Only the ESO panorama is a true equirect; nebula photos are flat telescope frames used as large distant curved backdrops, never full spheres.

## Implementation phases
### Phase 1 — Door fix (Bug A) — stage.js, door.js
- Fix invalid font shorthand in `burn()`; audit every `ctx.font` to valid `"<weight> <size>px <family>"` using bundled Montserrat.
- Add a `roll` channel to doorCam (applied as camera rotation.z offset in the render loop, default 0 — additive, seam-safe).
- Punch up MASK_SNAP: dolly 1.05 → 1.12 eased, −2.5° opening roll settling to 0, harder-eased pitch snap, single-frame exposure glitch on the snap. All moves stay pure functions of u.
- Restyle burned hook with Phase-3 typography so frame zero is a real thumbnail hook.

### Phase 2 — Loop seam guarantee (Bug B) — Studio.jsx, door.js
- One shared `remainingSeconds()` helper drives both auto-cut and seam. In live-mic mode, when `voice.done` is unconfirmed, gate the seam on caption-remaining alone.
- During `seam(u)`: lerp camera AND fade the frame-zero hook burn back in (canvas alpha 0→1 across the seam) AND re-apply per-move actor visibility — last frame pixel-equals frame zero.
- Stop ordering: on auto-cut, hold the door pose until MediaRecorder.stop() has flushed (onstop/final dataavailable), then reset to neutral. Manual stop keeps instant abort.

### Phase 3 — Professional captions — stage.js, index.html, fonts
- Register @font-face + `<link rel="preload">`; await `document.fonts.load('900 100px Montserrat')` during stage boot.
- Karaoke (`drawCaptionChunk`): 2048×440 canvas (2×); 900-weight caps; white fill + black outline ~8% of font size + soft drop shadow; active word #FF2E63 with 120ms scale-pop 1.0→1.08 ease-out animated per-frame from `updateCaptionAnim`. Keep 1–3 word chunks, position, recognition-driven word index untouched.
- Hook / CTA / insert planes: same type system; hook auto-highlights longest content word in crimson; flat black rects → soft gradient scrim; CTA in sentence case.

### Phase 4 — Real hybrid imagery — worlds.js
- New `photoSky(url, {tint, exposure})` helper: SphereGeometry(BackSide) with milkyway_4k, SRGBColorSpace, slow rotation, per-world tint (hueShift hook preserved). Replaces flat `scene.background` in all 5 worlds.
- Per-world: nebula-drift → carina_ir_2k curved distant backdrop, drop FBM nebulaVolume raymarch; derelict-station → eagle_spire_2k backdrop; dying-star → carina_hst_2k backdrop; red-planet / asteroid-earth → photo sky only.
- Demote (don't delete) `starDome()` to sparse twinkle layer; meteorShower, parallax, setEnergy, dispose untouched; worldPresets.js params keep working.

### Phase 5 — Verification
- Build passes; agent-browser smoke: fonts loaded, 5 worlds render photo skies, captions crisp.
- Scripted-take dry run: hook visible at frame zero, door move reads as choreography, seam log shows u ramping 0→1, first/last frame match.
- Remove [v0] logs.

## Files touched
- frontend/src/studio/stage.js — font fix + preload await, caption/overlay renderers, doorCam roll
- frontend/src/studio/door.js — MASK_SNAP tuning, seam completeness
- frontend/src/pages/Studio.jsx — shared remaining helper, seam gate, stop ordering
- frontend/src/studio/worlds.js — photoSky helper, per-world backdrops, nebulaVolume demotion
- frontend/public/index.html — @font-face + preloads

## Out of scope
No changes to voice/recognition pipeline, recorder tiers, music engine, or script data. No end card.

## Progress log
- [x] Assets downloaded, optimized (woff2 subsets, 4k sky), committed (c1ed49b)
- [x] door.js: roll channel added, MASK_SNAP punched up, snap glitch fired, roll through seam
- [~] stage.js: doorCam roll edit was in progress when session cut — VERIFY state before continuing
- [ ] stage.js: font fix, Montserrat type system, 2× caption canvas, scrims, setBurnAlpha
- [ ] Studio.jsx: remainingSeconds helper, seam gate, stop ordering
- [ ] index.html: @font-face + preloads
- [ ] worlds.js: photoSky + backdrops
- [ ] Build + browser verification
