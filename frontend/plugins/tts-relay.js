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

// The one perfect voice: Andrew — warm, confident, hyper-clear US male.
const VOICE = "en-US-AndrewMultilingualNeural";
const PROSODY = { rate: "+12%", pitch: "+10Hz", volume: "+0%" };

// tiny in-memory cache: re-synthesizing an unchanged line is pure waste
const cache = new Map(); // text -> Buffer
const CACHE_MAX = 200;

async function synthesize(text) {
  const hit = cache.get(text);
  if (hit) return hit;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text, PROSODY);
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
  cache.set(text, buf);
  return buf;
}

/* The express handler for GET /tts. Exposed as a middleware entry so it can
   be UNSHIFTED to the FRONT of the dev server's middleware stack — anything
   appended via devServer.app runs after the SPA history fallback, which would
   answer /tts with index.html before this code ever saw the request. */
async function ttsHandler(req, res) {
  const text = String(req.query.text || "").slice(0, 600).trim();
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  try {
    const buf = await synthesize(text);
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
