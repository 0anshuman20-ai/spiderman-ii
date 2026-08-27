/* ---------------------------------------------------------------------------
   /lenslab — DEV-ONLY lens geometry harness.

   There is no webcam in the build sandbox, so the mask lenses cannot be checked
   against a live face. This page renders the REAL exported geometry
   (lensPlacement + drawLensPair from studio/suit.js — not a copy) over a
   synthetic face across a grid of head roll / yaw / face-size values, and
   prints the derived numbers that matter.

   Tuning loop: edit the four constants at the top of studio/suit.js
   (LENS_TILT, LENS_SIZE_K, LENS_INNER, BRIDGE_GAP), reload, compare.

   The one hard invariant: BRIDGE must stay positive in every cell. If it goes
   to zero the two rubber rims have merged into a single black band across the
   nose, which is the failure mode that hardcoding both size and spread causes.
   Cells self-report PASS/FAIL on it.

   Nothing here is imported by the recording path.
   ------------------------------------------------------------------------- */
import { useEffect, useRef } from 'react';
import { lensPlacement, drawLensPair, LENS_TUNING } from '@/studio/suit';

const CELL_W = 260;
const CELL_H = 300;

/* roll = head tilt (rad), yaw = head turn (rad), d = true interpupillary px */
const CASES = [
  { label: 'rest', roll: 0, yaw: 0, d: 96 },
  { label: 'roll +14deg', roll: 0.25, yaw: 0, d: 96 },
  { label: 'roll -14deg', roll: -0.25, yaw: 0, d: 96 },
  { label: 'yaw 30deg', roll: 0, yaw: 0.52, d: 96 },
  { label: 'yaw 45deg', roll: 0, yaw: 0.79, d: 96 },
  { label: 'roll+yaw', roll: 0.2, yaw: 0.45, d: 96 },
  { label: 'close (big)', roll: 0, yaw: 0, d: 128 },
  { label: 'far (small)', roll: 0, yaw: 0, d: 64 },
  { label: 'far + roll', roll: -0.3, yaw: 0.3, d: 64 },
];

/* a plain synthetic head so placement is judgeable: skull oval, brow line,
   nose bridge, cheekbones, and the two true eye positions as crosshairs. */
function drawFace(g, cx, cy, d, roll, yaw) {
  const obs = d * Math.cos(yaw); // foreshortened eye distance, as a tracker sees it
  const ca = Math.cos(roll), sa = Math.sin(roll);
  g.save();
  g.translate(cx, cy);
  g.rotate(roll);
  // skull
  g.beginPath();
  g.ellipse(0, d * 0.12, obs * 1.12, d * 1.5, 0, 0, Math.PI * 2);
  g.fillStyle = '#2a2320';
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 1;
  g.stroke();
  // nose bridge — the line the lens seam must never swallow
  g.beginPath();
  g.moveTo(0, -d * 0.5);
  g.lineTo(0, d * 0.62);
  g.strokeStyle = 'rgba(255,255,255,0.20)';
  g.stroke();
  // brow line
  g.beginPath();
  g.moveTo(-obs * 0.85, -d * 0.34);
  g.quadraticCurveTo(0, -d * 0.46, obs * 0.85, -d * 0.34);
  g.stroke();
  g.restore();
  // true eye centres (crosshairs) in world space
  [-1, 1].forEach((s) => {
    const ex = cx + ca * (s * obs) / 2;
    const ey = cy + sa * (s * obs) / 2;
    g.beginPath();
    g.moveTo(ex - 5, ey);
    g.lineTo(ex + 5, ey);
    g.moveTo(ex, ey - 5);
    g.lineTo(ex, ey + 5);
    g.strokeStyle = 'rgba(255,90,90,0.85)';
    g.lineWidth = 1.5;
    g.stroke();
  });
}

function Cell({ c }) {
  const ref = useRef(null);
  const obs = c.d * Math.cos(c.yaw);
  // mirrors suit.js: yaw foreshortens the eye distance but not your distance to
  // camera, so cos(yaw) is divided back out to hold true lens size
  const yawC = Math.max(0.55, Math.abs(Math.cos(c.yaw)));
  const size = (obs / yawC) * LENS_TUNING.LENS_SIZE_K;
  const pl = lensPlacement(CELL_W / 2, CELL_H / 2, obs / 2, size, c.roll, obs);
  const outer = (obs / 2 + pl.offOut) + 1.27 * size; // rim outer reach from centreline
  const ok = pl.bridge > 0.5;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, CELL_W, CELL_H);
    g.fillStyle = '#131313';
    g.fillRect(0, 0, CELL_W, CELL_H);
    drawFace(g, CELL_W / 2, CELL_H / 2, c.d, c.roll, c.yaw);
    drawLensPair(g, pl, size, c.roll, 1);
  }, [c, pl, size]);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <canvas
        ref={ref}
        width={CELL_W}
        height={CELL_H}
        className="w-full rounded border border-white/10"
      />
      <figcaption className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-neutral-400">
        <span className="text-neutral-200">{c.label}</span>
        <span>size {size.toFixed(1)}px / offOut {pl.offOut.toFixed(1)}</span>
        <span>outer reach {(outer / obs).toFixed(2)} x eyeDist</span>
        <span className={ok ? 'text-emerald-400' : 'text-red-400'}>
          bridge {pl.bridge.toFixed(1)}px {ok ? 'PASS' : 'FAIL — rims merged'}
        </span>
      </figcaption>
    </figure>
  );
}

export default function LensLab() {
  const t = LENS_TUNING;
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-200">
      <header className="mb-8 flex flex-col gap-3">
        <h1 className="font-mono text-lg tracking-tight text-white">lens lab</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-neutral-400">
          Real exported geometry over a synthetic face. Red crosshairs are your true
          eye centres; the vertical line is the nose bridge. Edit the four constants
          in <code className="text-neutral-300">studio/suit.js</code> and reload.
        </p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-neutral-400">
          <div className="flex gap-2">
            <dt>LENS_TILT</dt>
            <dd className="text-neutral-100">
              {t.LENS_TILT} rad ({((t.LENS_TILT * 180) / Math.PI).toFixed(1)} deg)
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>LENS_SIZE_K</dt>
            <dd className="text-neutral-100">{t.LENS_SIZE_K}</dd>
          </div>
          <div className="flex gap-2">
            <dt>LENS_INNER</dt>
            <dd className="text-neutral-100">{t.LENS_INNER}</dd>
          </div>
          <div className="flex gap-2">
            <dt>BRIDGE_GAP</dt>
            <dd className="text-neutral-100">{t.BRIDGE_GAP}</dd>
          </div>
        </dl>
      </header>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CASES.map((c) => (
          <Cell key={c.label} c={c} />
        ))}
      </div>
    </main>
  );
}
