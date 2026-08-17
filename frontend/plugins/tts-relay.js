/* THE ONE VOICE — dev-server relay to Microsoft Edge neural TTS.

   Why a relay exists at all: the free StreamElements/Polly ladder the app
   shipped with is dead (every voice now returns 401), and Edge's neural
   endpoint — the highest-quality keyless TTS on the internet, the literal
   voice behind most billion-view faceless Shorts channels — only accepts
   WebSocket handshakes carrying an Edge User-Agent and extension Origin.
   A browser cannot forge those headers; a Node process can. So the dev
   server answers GET /tts?text=... itself and streams back an MP3.

   The voice is LOCKED server-side. One voice. One identity. Every take,
   every upload, the same recognizable narrator — that consistency is a
   growth lever, not a limitation, so the endpoint deliberately refuses to
   let the client pick. Prosody is tuned once, here: a touch faster and a
   touch brighter than stock reads as "young hero", not "news anchor". */

const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

// The one perfect voice: Brian — the youngest-reading neural US male Edge
// ships. Pushed a touch faster and noticeably brighter, he lands squarely on
// "wired teenage hero mid-swing" instead of Andrew's "warm adult narrator".
const VOICE = "en-US-BrianMultilingualNeural";

/* MOODS — same locked voice, four locked deliveries. The client may only name
   a mood; the prosody numbers live here and nowhere else. `mystery` is the
   channel default: slower and lower than the hero read, so every fact lands
   like a secret instead of a headline. */
const MOODS = {
  mystery: { rate: "-2%", pitch: "-6Hz", volume: "+0%" },   // low, deliberate, leaning-in
  hero:    { rate: "+14%", pitch: "+18Hz", volume: "+0%" }, // the original wired young hero
  urgent:  { rate: "+18%", pitch: "+8Hz", volume: "+0%" },  // escalating, breathless
  somber:  { rate: "-8%", pitch: "-12Hz", volume: "+0%" },  // heavy, funereal, awed
};
const DEFAULT_MOOD = "hero";

// tiny in-memory cache: re-synthesizing an unchanged line is pure waste
const cache = new Map(); // `${mood}\u0000${text}` -> Buffer
const CACHE_MAX = 200;

async function synthesize(text, mood) {
  const prosody = MOODS[mood] || MOODS[DEFAULT_MOOD];
  const key = `${mood}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tts = new MsEdgeTTS();
  // 48kHz/192k — the highest fidelity the endpoint ships. The old 24kHz/96k
  // stream had no content above ~12kHz, which is the dull "phone speaker"
  // sheen; full-band audio restores the air and crispness of a studio read.
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_48KHZ_192KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text, prosody);
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    const kill = setTimeout(() => reject(new Error("tts timeout")), 15000);
    audioStream.on("data", (c) => chunks.push(c));
    audioStream.on("end", () => { clearTimeout(kill); resolve(Buffer.concat(chunks)); });
    audioStream.on("error", (e) => { clearTimeout(kill); reject(e); });
  });
  try { tts.close(); } catch (_) {}
  if (!buf || buf.length < 200) throw new Error("empty audio");
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, buf);
  return buf;
}

/* The express handler for GET /tts. Exposed as a middleware entry so it can
   be UNSHIFTED to the FRONT of the dev server's middleware stack — anything
   appended via devServer.app runs after the SPA history fallback, which would
   answer /tts with index.html before this code ever saw the request. */
async function ttsHandler(req, res) {
  const text = String(req.query.text || "").slice(0, 600).trim();
  const mood = MOODS[String(req.query.mood || "")] ? String(req.query.mood) : DEFAULT_MOOD;
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  try {
    const buf = await synthesize(text, mood);
    res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: `tts relay failed: ${err.message}` });
  }
}

/** Prepend the /tts relay to the dev server middleware stack. */
function setupTtsRelay(middlewares) {
  middlewares.unshift({ name: "tts-relay", path: "/tts", middleware: ttsHandler });
  return middlewares;
}

module.exports = { setupTtsRelay, VOICE };
