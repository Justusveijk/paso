"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import * as Tone from "tone";

/* ─── SUPABASE ─── */
const SUPABASE_URL = "https://qfpjdhjduailcgxkoabe.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcGpkaGpkdWFpbGNneGtvYWJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDM0NTgsImV4cCI6MjA4ODAxOTQ1OH0.bkYmtqywP4kdr248177N-Y5P6NzYzWxQEZ6zpi26sXg";

function generateId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function saveRoadmap(roadmapData, answersData, goalText) {
  const id = generateId();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/roadmaps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({ id, goal: goalText, roadmap: roadmapData, answers: answersData }),
  });
  if (!res.ok) throw new Error("Failed to save");
  return id;
}

async function loadRoadmap(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/roadmaps?id=eq.${id}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error("Failed to load");
  const data = await res.json();
  if (!data.length) throw new Error("Roadmap not found");
  return data[0];
}

/* ─── SOUND SYSTEM — Minecraft-style ambient ─── */
let audioReady = false;
let synths = {};
let ambientTimeout = null;
let ambientRunning = false;

async function initAudio() {
  if (audioReady) return;
  try {
    await Tone.start();
    audioReady = true;

    // Warm reverb — immersive but not cathedral-like
    const bigVerb = new Tone.Reverb({ decay: 7, wet: 0.55 }).toDestination();
    const warmDelay = new Tone.FeedbackDelay("4n", 0.1).connect(bigVerb);
    warmDelay.wet.value = 0.15;

    // Felt piano — warm dampened keys
    const feltFilter = new Tone.Filter(1800, "lowpass").connect(warmDelay);
    synths.piano = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.35, decay: 2.5, sustain: 0.04, release: 5 },
      volume: -20,
    }).connect(feltFilter);

    // High piano — octave up for sparkle
    synths.pianoHigh = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.4, decay: 2, sustain: 0.03, release: 4 },
      volume: -25,
    }).connect(feltFilter);

    // Kalimba — plucked metallic warmth (the unique instrument)
    const kalimbaVerb = new Tone.Reverb({ decay: 4, wet: 0.5 }).toDestination();
    synths.kalimba = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 1.8, sustain: 0, release: 2.5 },
      volume: -22,
    }).connect(kalimbaVerb);

    // Water texture — pink noise through bandpass sounds like running water
    const waterBP = new Tone.Filter({ frequency: 1200, type: "bandpass", Q: 0.8 }).connect(bigVerb);
    const waterLP = new Tone.Filter(2000, "lowpass").connect(waterBP);
    const noiseGain = new Tone.Gain(0).connect(waterLP);
    synths.nature = new Tone.Noise("pink").connect(noiseGain);
    synths.nature.volume.value = -22;
    synths.natureGain = noiseGain;

    // Bird chirps — louder, more present
    const birdVerb = new Tone.Reverb({ decay: 2, wet: 0.4 }).toDestination();
    synths.bird = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.003, decay: 0.1, sustain: 0, release: 0.2 },
      volume: -20,
    }).connect(birdVerb);

    // Hover whisper
    const hoverVerb = new Tone.Reverb({ decay: 3, wet: 0.6 }).toDestination();
    synths.hover = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.15, decay: 0.6, sustain: 0, release: 1.5 },
      volume: -32,
    }).connect(hoverVerb);

    // Chime — reveal sound
    const chimeVerb = new Tone.Reverb({ decay: 2.5, wet: 0.5 }).toDestination();
    synths.chime = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.35, sustain: 0, release: 1.5 },
      volume: -20,
    }).connect(chimeVerb);

    // Muted bell tick — round milestone check
    const bellTickVerb = new Tone.Reverb({ decay: 2, wet: 0.45 }).toDestination();
    synths.tick = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.008, decay: 0.4, sustain: 0, release: 1.2 },
      volume: -18,
    }).connect(bellTickVerb);

    // Bell — gentle high tones for late ambient
    const bellDelay = new Tone.FeedbackDelay("8n", 0.1).connect(bigVerb);
    bellDelay.wet.value = 0.2;
    synths.bell = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 1.2, sustain: 0, release: 2.5 },
      volume: -26,
    }).connect(bellDelay);

  } catch (e) { console.warn("Audio init failed:", e); }
}

// Notes progress from neutral → hopeful (minor pentatonic → major pentatonic)
const NOTES_EARLY = ["C3", "E3", "G3", "A3", "C4", "E4", "G4"]; // C major — open, neutral
const NOTES_MID = ["C4", "E4", "G4", "A4", "C5", "D5", "E5"]; // higher, brighter
const NOTES_LATE = ["D4", "E4", "G4", "A4", "B4", "D5", "E5", "G5"]; // G major — uplifting, resolved
const NOTES_HIGH = ["E5", "G5", "A5", "B5", "D6"]; // sparkle layer
let ambientAge = 0;

function playAmbientNote() {
  if (!audioReady || !ambientRunning) return;
  ambientAge++;

  // Pick notes based on progression — gets brighter over time
  const phase = ambientAge > 16 ? "late" : ambientAge > 8 ? "mid" : "early";
  const notes = phase === "late" ? NOTES_LATE : phase === "mid" ? NOTES_MID : NOTES_EARLY;
  const useHigh = phase === "late" ? Math.random() < 0.35 : Math.random() < 0.15;
  const playNotes = useHigh ? NOTES_HIGH : notes;
  const note = playNotes[Math.floor(Math.random() * playNotes.length)];
  const synth = useHigh ? synths.pianoHigh : synths.piano;
  synth?.triggerAttackRelease(note, "1n");

  // Double notes — more frequent as it progresses (feels fuller, more hopeful)
  const doubleChance = phase === "late" ? 0.45 : phase === "mid" ? 0.35 : 0.25;
  if (Math.random() < doubleChance) {
    const delay = 500 + Math.random() * 1000;
    setTimeout(() => {
      if (!ambientRunning) return;
      const n2 = playNotes[Math.floor(Math.random() * playNotes.length)];
      synth?.triggerAttackRelease(n2, "1n");
    }, delay);
  }

  // Water texture — gets slightly louder over time
  if (synths.natureGain) {
    const targetVol = phase === "late" ? 0.22 : phase === "mid" ? 0.18 : 0.14;
    synths.natureGain.gain.rampTo(targetVol, 4);
  }

  // Kalimba — warm plucked notes, more frequent as mood lifts
  if (ambientAge > 4 && synths.kalimba && Math.random() < (phase === "late" ? 0.45 : 0.25)) {
    const kalimbaNotes = phase === "late" ? ["G5", "A5", "B5", "D6", "E6"] : ["C5", "E5", "G5", "A5"];
    const kDelay = 300 + Math.random() * 800;
    setTimeout(() => {
      if (!ambientRunning) return;
      synths.kalimba.triggerAttackRelease(kalimbaNotes[Math.floor(Math.random() * kalimbaNotes.length)], "8n");
    }, kDelay);
  }

  // Bird chirps — arrive early, get more frequent
  if (ambientAge > 3 && synths.bird && Math.random() < (phase === "late" ? 0.45 : phase === "mid" ? 0.3 : 0.18)) {
    const birdDelay = 600 + Math.random() * 1500;
    setTimeout(() => {
      if (!ambientRunning) return;
      const birdBase = 2200 + Math.random() * 1400;
      const now = Tone.now();
      synths.bird.frequency.setValueAtTime(birdBase, now);
      synths.bird.triggerAttackRelease("16n", now);
      if (Math.random() < 0.65) {
        synths.bird.frequency.setValueAtTime(birdBase * (1.05 + Math.random() * 0.15), now + 0.1);
        synths.bird.triggerAttackRelease("16n", now + 0.1);
      }
      if (Math.random() < 0.35) {
        synths.bird.frequency.setValueAtTime(birdBase * (0.95 + Math.random() * 0.12), now + 0.2);
        synths.bird.triggerAttackRelease("16n", now + 0.2);
      }
    }, birdDelay);
  }

  // Gentle bells — celebratory in late phase
  if (ambientAge > 6 && synths.bell && Math.random() < (phase === "late" ? 0.35 : 0.18)) {
    const bellNotes = phase === "late" ? ["B5", "D6", "E6", "G6"] : ["G5", "A5", "C6", "D6"];
    synths.bell.triggerAttackRelease(bellNotes[Math.floor(Math.random() * bellNotes.length)], "8n");
  }

  // Schedule next — gets denser (more alive) as it progresses
  const baseDelay = phase === "late" ? 1800 : phase === "mid" ? 2200 : 2800;
  const nextDelay = baseDelay + Math.random() * 3000;
  ambientTimeout = setTimeout(playAmbientNote, nextDelay);
}

function startAmbient() {
  if (!audioReady || ambientRunning) return;
  ambientRunning = true;
  ambientTimeout = setTimeout(playAmbientNote, 1000);
  // Start nature texture — gentle wind fading in
  try {
    if (synths.nature && synths.natureGain) {
      synths.nature.start();
      synths.natureGain.gain.rampTo(0.12, 8); // slow fade in over 8 seconds
    }
  } catch (e) { /* noise may already be running */ }
}

function stopAmbient() {
  ambientRunning = false;
  ambientAge = 0;
  if (ambientTimeout) { clearTimeout(ambientTimeout); ambientTimeout = null; }
  // Fade out nature texture
  try {
    if (synths.natureGain) {
      synths.natureGain.gain.rampTo(0, 2);
      setTimeout(() => { try { synths.nature?.stop(); } catch(e) {} }, 2200);
    }
  } catch (e) {}
}

// Hover whisper — random high pentatonic note, very quiet
function playHoverWhisper() {
  if (!audioReady) return;
  const notes = ["G5", "A5", "C6", "D6", "E6"];
  synths.hover?.triggerAttackRelease(notes[Math.floor(Math.random() * notes.length)], "16n");
}

// Reveal chime — 2 quick notes
function playRevealChime() {
  if (!audioReady) return;
  const now = Tone.now();
  synths.chime?.triggerAttackRelease("E5", "16n", now);
  synths.chime?.triggerAttackRelease("G5", "8n", now + 0.12);
}

// Unlock — ascending pentatonic run
function playUnlockSound() {
  if (!audioReady) return;
  const now = Tone.now();
  ["C5", "E5", "G5", "C6"].forEach((n, i) => {
    synths.chime?.triggerAttackRelease(n, "16n", now + i * 0.1);
  });
}

// Milestone tick — ascending pitch, gets more positive each check
let milestoneTickCount = 0;
const TICK_SCALE = ["C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6", "D6", "E6", "F6", "G6", "A6", "B6", "C7"];
function playMilestoneTick() {
  if (!audioReady) return;
  const note = TICK_SCALE[milestoneTickCount % TICK_SCALE.length];
  synths.tick?.triggerAttackRelease(note, "16n");
  milestoneTickCount++;
}

// Breakdown done
function playBreakdownDone() {
  if (!audioReady) return;
  const now = Tone.now();
  synths.chime?.triggerAttackRelease("D5", "16n", now);
  synths.chime?.triggerAttackRelease("G5", "16n", now + 0.1);
}

// Phase complete celebration — euphoric ascending arpeggio with shimmer
function playCelebration() {
  if (!audioReady) return;
  const now = Tone.now();
  // Main rising arpeggio — warm and triumphant
  const main = ["C4", "E4", "G4", "C5", "E5", "G5", "C6"];
  main.forEach((n, i) => {
    synths.piano?.triggerAttackRelease(n, "4n", now + i * 0.08);
  });
  // Sparkle layer — high bell tones scattered on top
  const sparkle = ["E6", "G6", "A6", "C7"];
  sparkle.forEach((n, i) => {
    setTimeout(() => {
      if (synths.bell) synths.bell.triggerAttackRelease(n, "16n");
    }, 300 + i * 120 + Math.random() * 80);
  });
  // Kalimba cascade underneath
  setTimeout(() => {
    const notes = ["C5", "E5", "G5", "C6"];
    notes.forEach((n, i) => setTimeout(() => synths.kalimba?.triggerAttackRelease(n, "8n"), i * 100));
  }, 200);
}

/* ─── INTERSECTION OBSERVER ─── */
function useInView(opts = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.unobserve(el); } },
      { threshold: 0.12, ...opts }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
}

/* ─── MOBILE DETECTION ─── */
function useIsMobile(bp = 640) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const check = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [bp]);
  return m;
}

/* ─── REVEAL ─── */
function Reveal({ children, delay = 0, direction = "up", style = {} }) {
  const [ref, inView] = useInView();
  const t = { up: "translateY(40px)", left: "translateX(40px)", right: "translateX(-40px)", none: "none" };
  return (
    <div ref={ref} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? "translate(0,0)" : (t[direction] || t.up),
      transition: `opacity 0.85s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.85s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
      ...style,
    }}>{children}</div>
  );
}

/* ─── GLASS ─── */
function Glass({ children, style = {}, hover = false, padding, onClick }) {
  const [h, setH] = useState(false);
  const mob = useIsMobile();
  const pad = padding !== undefined ? padding : (mob ? 18 : 28);
  return (
    <div onClick={onClick}
      onMouseEnter={() => { setH(true); if (hover) playHoverWhisper(); }}
      onMouseLeave={() => setH(false)}
      style={{
        background: h && hover ? "rgba(255,255,255,0.52)" : "rgba(255,255,255,0.45)",
        backdropFilter: "blur(28px) saturate(150%)",
        WebkitBackdropFilter: "blur(28px) saturate(150%)",
        border: `1px solid rgba(255,255,255,${h && hover ? 0.7 : 0.55})`,
        borderRadius: 22, padding: pad,
        boxShadow: h && hover
          ? "0 20px 60px rgba(0,0,0,0.08), 0 0 40px rgba(108,92,231,0.06), inset 0 1px 0 rgba(255,255,255,0.8)"
          : "0 4px 20px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.7)",
        transform: h && hover ? "translateY(-3px)" : "translateY(0)",
        transition: "all 0.6s cubic-bezier(0.16,1,0.3,1)",
        ...style,
      }}>{children}</div>
  );
}

/* ─── ICONS (no emoji) ─── */
const Icon = {
  check: (sz = 10, c = "#fff") => (
    <svg width={sz} height={sz} viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  lock: (sz = 12, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="2" stroke={c} strokeWidth="1.5"/><path d="M5 7V5a3 3 0 016 0v2" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>
  ),
  close: (sz = 12, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>
  ),
  bolt: (sz = 12, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M8.5 1L3 9h4.5l-1 6L13 7H8.5l1-6z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>
  ),
  arrow: (sz = 11, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  phases: (sz = 16, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="4" height="4" rx="1" stroke={c} strokeWidth="1.2"/><rect x="10" y="2" width="4" height="4" rx="1" stroke={c} strokeWidth="1.2"/><rect x="2" y="10" width="4" height="4" rx="1" stroke={c} strokeWidth="1.2"/><rect x="10" y="10" width="4" height="4" rx="1" stroke={c} strokeWidth="1.2"/></svg>
  ),
  loop: (sz = 16, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4" stroke={c} strokeWidth="1.2" strokeLinecap="round"/><path d="M12.5 1v3h-3M3.5 15v-3h3" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  doc: (sz = 16, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={c} strokeWidth="1.2"/><path d="M9 2v4h4" stroke={c} strokeWidth="1.2"/><path d="M5 9h6M5 11.5h4" stroke={c} strokeWidth="1.2" strokeLinecap="round"/></svg>
  ),
  share: (sz = 16, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><circle cx="12" cy="4" r="2" stroke={c} strokeWidth="1.2"/><circle cx="4" cy="8" r="2" stroke={c} strokeWidth="1.2"/><circle cx="12" cy="12" r="2" stroke={c} strokeWidth="1.2"/><path d="M5.8 7.1l4.4-2.2M5.8 8.9l4.4 2.2" stroke={c} strokeWidth="1.2"/></svg>
  ),
  science: (sz = 16, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M6 2v4.5L2.5 13a1 1 0 00.9 1.5h9.2a1 1 0 00.9-1.5L10 6.5V2" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 2h6" stroke={c} strokeWidth="1.2" strokeLinecap="round"/><circle cx="7" cy="11" r="0.8" fill={c}/><circle cx="9.5" cy="12" r="0.6" fill={c}/></svg>
  ),
};

/* ─── PASO LOADING ORB ─── */
function PasoOrb({ progress = 0, interactive = false }) {
  const [hovered, setHovered] = useState(false);
  const fillHeight = Math.min(progress, 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
      <div
        style={{ position: "relative", width: 80, height: 80, cursor: interactive ? "pointer" : "default" }}
        onMouseEnter={() => { setHovered(true); playHoverWhisper(); }}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Outer glow — fades in/out smoothly */}
        <div style={{
          position: "absolute", inset: -24, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(108,92,231,0.25), transparent 70%)",
          animation: "orbPulse 2.5s ease-in-out infinite",
          opacity: hovered ? 1 : 0.4,
          transform: hovered ? "scale(1.25)" : "scale(1)",
          transition: "opacity 0.8s ease, transform 0.8s cubic-bezier(0.16,1,0.3,1)",
        }} />
        {/* Glass sphere */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
          background: hovered ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.35)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          border: `1px solid rgba(255,255,255,${hovered ? 0.75 : 0.5})`,
          boxShadow: hovered
            ? "0 8px 40px rgba(108,92,231,0.3), 0 0 60px rgba(108,92,231,0.15), inset 0 2px 4px rgba(255,255,255,0.7), inset 0 -2px 4px rgba(108,92,231,0.1)"
            : "0 8px 32px rgba(108,92,231,0.12), inset 0 2px 4px rgba(255,255,255,0.6), inset 0 -2px 4px rgba(108,92,231,0.06)",
          animation: "orbFloat 3s ease-in-out infinite",
          transition: "background 0.8s ease, border 0.8s ease, box-shadow 0.8s ease",
        }}>
          {/* Fill level */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            height: `${fillHeight}%`,
            background: "linear-gradient(0deg, rgba(108,92,231,0.18), rgba(108,92,231,0.04))",
            borderRadius: "0 0 50% 50%",
            transition: "height 0.8s cubic-bezier(0.16,1,0.3,1)",
          }} />
          {/* Refraction highlight */}
          <div style={{
            position: "absolute", top: 12, left: 14, width: 28, height: 18, borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(255,255,255,0.6), transparent)",
            transform: "rotate(-15deg)",
          }} />
          {/* Inner accent */}
          <div style={{
            position: "absolute", bottom: 16, right: 16, width: 14, height: 14, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(108,92,231,0.15), transparent)",
            animation: "orbDrift 4s ease-in-out infinite",
          }} />
        </div>
        {/* Orbiting dot */}
        <div style={{ position: "absolute", inset: -6, animation: "orbSpin 3s linear infinite" }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%", background: ACCENT,
            opacity: hovered ? 0.7 : 0.3,
            boxShadow: hovered ? "0 0 16px rgba(108,92,231,0.5)" : "0 0 6px rgba(108,92,231,0.2)",
            transition: "opacity 0.8s ease, box-shadow 0.8s ease",
          }} />
        </div>
      </div>
    </div>
  );
}

/* ─── DESIGN TOKENS ─── */
const H = "'Playfair Display', Georgia, serif";
const M = { fontFamily: "'JetBrains Mono', monospace" };
const B = { fontFamily: "'DM Sans', sans-serif" };
const ACCENT = "#6C5CE7";
const INK = "#1a1a2e";
const INK70 = "rgba(26,26,46,0.75)";
const INK60 = "rgba(26,26,46,0.65)";
const INK50 = "rgba(26,26,46,0.6)";
const INK45 = "rgba(26,26,46,0.55)";
const INK40 = "rgba(26,26,46,0.5)";
const INK30 = "rgba(26,26,46,0.42)";
const INK25 = "rgba(26,26,46,0.35)";
const INK22 = "rgba(26,26,46,0.3)";
const INK12 = "rgba(26,26,46,0.14)";
const INK08 = "rgba(26,26,46,0.1)";

/* ─── API ─── */
async function callClaude(system, userMsg, maxTokens = 1024, _retry = true) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-api-key": process.env.NEXT_PUBLIC_ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `API error: ${res.status}`);
    }
    const data = await res.json();
    const text = data.content.map((c) => c.text || "").join("");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("No valid JSON in response");
    }
    const jsonStr = text.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonStr);
  } catch (e) {
    // Silent retry once
    if (_retry) {
      console.warn("Retrying API call:", e.message);
      return callClaude(system, userMsg, maxTokens, false);
    }
    console.error("API failed after retry:", e.message);
    throw new Error("Something went wrong. Please try again.");
  }
}

async function generateQuestions(goal) {
  return callClaude(
    `You are Paso, an AI roadmap generator. Given a goal, generate smart follow-up questions to personalize the roadmap.

Respond with ONLY valid JSON. Start with { and end with }. No markdown, no backticks.

{"intro":"A short encouraging 1-sentence acknowledgment of their goal","questions":[{"id":"q1","question":"text","type":"select","options":["A","B","C"]},{"id":"q2","question":"text","type":"multi_select","options":["A","B","C"]},{"id":"q3","question":"text","type":"select","options":["A","B","C"]},{"id":"q4","question":"text","type":"text","placeholder":"example text"}]}

Generate exactly 4 questions:
- Each has type: "select" (pick one), "multi_select" (pick multiple), or "text" (free text)
- Use "select" for single-answer questions (timeline, experience level)
- Use "multi_select" for multi-answer questions (interests, motivations, constraints)
- Last question MUST be type "text" with "placeholder" field
- Have at least 1 select, at least 1 multi_select, exactly 1 text (last)
- Options: concise, max 6 words each, 3-4 options
- Conversational tone, each question should meaningfully change the roadmap`,
    `Goal: ${goal}`
  );
}

async function generateRoadmap(goal, answers, extras) {
  const context = answers.map((a) => {
    const val = Array.isArray(a.answer) ? a.answer.join(", ") : a.answer;
    const extra = extras && extras[a.id] ? ` (additional context: ${extras[a.id]})` : "";
    return `${a.question}: ${val}${extra}`;
  }).join("\n");
  return callClaude(
    `You are Paso, an AI roadmap generator by Numina Labs. Create a deeply personalized, evidence-based roadmap.

You MUST respond with ONLY valid JSON. Start directly with { and end with }. No markdown, no backticks, no preamble.

{
  "goal": "the goal restated in max 6 words — short, sharp, memorable. NOT a full sentence. Examples: 'Launch my first startup', 'Become a working model', 'Run a sub-2h half marathon'",
  "timeline": "realistic timeframe like '24 weeks' or '6 months'",
  "tagline": "one short inspiring line, max 8 words",
  "summary": "1-2 sentences max about the approach, referencing their situation",
  "closingQuote": "A real, verified quote from someone notable in this specific field or in goal-setting. Must be a real quote from a real person — not made up. Format: the quote text only.",
  "closingQuoteAuthor": "Full name and brief role, e.g. 'Coco Chanel, fashion designer' or 'Elon Musk, entrepreneur'",
  "phases": [
    {
      "title": "phase name (2-3 words max)",
      "weeks": "Weeks 1-4",
      "description": "1-2 sentences personalized to their context",
      "milestones": ["4 specific measurable milestones"],
      "actions": ["3 concrete actions to start THIS week"],
      "insight": "One concise insight with a specific scientific reference (researcher, year). Max 2 sentences. Example: 'Deliberate practice matters more than talent — Ericsson et al., 1993.'",
      "sideQuest": "One fun bonus activity that accelerates progress. Max 1-2 sentences. Be specific and unexpected.",
      "realityCheck": "ONLY for Phase 1. An honest, grounding reality check about this goal — common pitfalls, realistic expectations, or hard truths. Honest but hopeful. 2-3 sentences. For phases 2-4, set this to null."
    }
  ]
}

CRITICAL RULES:
- Create exactly 4 phases
- Phase 1 MUST include a non-null realityCheck — be honest about common mistakes and realistic timelines, but keep it encouraging. Phases 2-4 should have realityCheck set to null.
- Every "insight" MUST include a specific scientific reference (study, researcher, year, or book). Use real research — Ericsson, Dweck, Duckworth, Kahneman, Cialdini, etc. Match the research to the domain.
- Every "sideQuest" should feel like a fun detour that secretly accelerates growth. Include a brief research backing if possible.
- Phase titles should be short and evocative (2-3 words max)
- The closingQuote MUST be a real quote from a real person in this specific industry or domain. Do NOT invent quotes.
- Make everything specific to THEIR situation
- The roadmap should feel written by a mentor who reads research papers`,
    `Goal: ${goal}\n\nContext:\n${context}`,
    4096
  );
}

async function breakdownPhase(goal, phase, mode) {
  const system = mode === "mini"
    ? `You are Paso, an AI roadmap generator. Break the given phase into a 4-step mini-roadmap.

You MUST respond with ONLY valid JSON. Start directly with { — no markdown, no backticks, no preamble.

{"steps":[{"title":"Step name","timeline":"e.g. Days 1-3","description":"2 sentences describing what to do and why.","actions":["Specific action 1","Specific action 2","Specific action 3"]}]}

Create exactly 4 steps. Each step must have title, timeline, description, and 2-3 actions. Be specific and actionable.`
    : `You are Paso, an AI roadmap generator. Convert the given phase into a detailed daily schedule for 2 weeks.

You MUST respond with ONLY valid JSON. Start directly with { — no markdown, no backticks, no preamble.

{"weeks":[{"week":1,"days":[{"day":"Monday","tasks":["Specific task 1","Specific task 2"]}]}]}

Create exactly 2 weeks. Each week has 5-7 days. Each day has 2-3 specific tasks. Be practical and actionable.`;

  return callClaude(
    system,
    `Goal: ${goal}\nPhase: ${phase.title} (${phase.weeks})\nDescription: ${phase.description}\nMilestones: ${phase.milestones.join("; ")}\nActions: ${phase.actions.join("; ")}`,
    3072
  );
}

/* ─── CHECKABLE MILESTONE ─── */
function Milestone({ text, checked, onToggle }) {
  return (
    <div onClick={onToggle} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start", cursor: "pointer", userSelect: "none" }}>
      <div style={{
        width: 16, height: 16, borderRadius: 5, flexShrink: 0, marginTop: 2,
        border: checked ? "none" : "1.5px solid rgba(108,92,231,0.25)",
        background: checked ? ACCENT : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.3s ease",
        boxShadow: checked ? "0 2px 8px rgba(108,92,231,0.25)" : "none",
      }}>
        {checked && Icon.check(10, "#fff")}
      </div>
      <span style={{
        ...B, fontSize: 13, lineHeight: 1.5,
        color: checked ? INK25 : INK60,
        textDecoration: checked ? "line-through" : "none",
        transition: "all 0.3s ease",
      }}>{text}</span>
    </div>
  );
}

/* ─── BREAKDOWN MODAL ─── */
function BreakdownView({ data, mode, onClose }) {
  if (!data) return null;
  return (
    <div style={{ marginTop: 20, animation: "slideUp 0.5s cubic-bezier(0.16,1,0.3,1) both" }}>
      <Glass style={{ background: "rgba(255,255,255,0.55)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT }}>
            {mode === "mini" ? "Mini-roadmap" : "Daily breakdown"}
          </span>
          <button onClick={onClose} style={{ ...M, fontSize: 10, color: INK25, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>{Icon.close(10, INK25)} Close</button>
        </div>
        {mode === "mini" && data.steps && data.steps.map((step, i) => (
          <div key={i} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: i < data.steps.length - 1 ? "1px solid rgba(26,26,46,0.05)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ ...M, fontSize: 11, color: ACCENT }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ ...B, fontSize: 14, fontWeight: 600, color: INK60 }}>{step.title}</span>
              <span style={{ ...M, fontSize: 10, color: INK25 }}>{step.timeline}</span>
            </div>
            <p style={{ ...B, fontSize: 13, color: INK45, lineHeight: 1.7, marginBottom: 10 }}>{step.description}</p>
            {step.actions && step.actions.map((a, j) => (
              <div key={j} style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "flex-start" }}>
                <span style={{ ...M, fontSize: 10, color: ACCENT }}>→</span>
                <span style={{ ...B, fontSize: 12, color: INK50, lineHeight: 1.5 }}>{a}</span>
              </div>
            ))}
          </div>
        ))}
        {mode === "daily" && data.weeks && data.weeks.map((week, i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <div style={{ ...M, fontSize: 10, letterSpacing: "0.1em", color: ACCENT, marginBottom: 12 }}>Week {week.week}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {week.days && week.days.map((day, j) => (
                <div key={j} style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(108,92,231,0.04)" }}>
                  <div style={{ ...M, fontSize: 9, color: INK25, letterSpacing: "0.08em", marginBottom: 6, textTransform: "uppercase" }}>{day.day}</div>
                  {day.tasks && day.tasks.map((t, k) => (
                    <div key={k} style={{ ...B, fontSize: 11, color: INK50, lineHeight: 1.5, marginBottom: 2 }}>• {t}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Glass>
    </div>
  );
}

/* ─── BUBBLE CELEBRATION ─── */
function BubbleCelebration({ active }) {
  const [bubbles, setBubbles] = useState([]);
  const triggered = useRef(false);

  useEffect(() => {
    if (!active || triggered.current) return;
    triggered.current = true;

    const allBubbles = [];
    // 3 staggered bursts from both sides
    [0, 0.3, 0.7].forEach((burstDelay) => {
      // Left side burst
      for (let i = 0; i < 16; i++) {
        allBubbles.push({
          id: `l-${burstDelay}-${i}`,
          side: "left",
          startX: -5 + Math.random() * 8,
          startY: 20 + Math.random() * 60,
          endX: 15 + Math.random() * 55,
          endY: Math.random() * 100,
          size: 8 + Math.random() * 22,
          delay: burstDelay + Math.random() * 0.25,
          duration: 1.2 + Math.random() * 1.4,
          hue: Math.random() < 0.6 ? "purple" : Math.random() < 0.5 ? "pink" : "teal",
        });
      }
      // Right side burst
      for (let i = 0; i < 16; i++) {
        allBubbles.push({
          id: `r-${burstDelay}-${i}`,
          side: "right",
          startX: 97 + Math.random() * 8,
          startY: 20 + Math.random() * 60,
          endX: 30 + Math.random() * 55,
          endY: Math.random() * 100,
          size: 8 + Math.random() * 22,
          delay: burstDelay + Math.random() * 0.25,
          duration: 1.2 + Math.random() * 1.4,
          hue: Math.random() < 0.6 ? "purple" : Math.random() < 0.5 ? "pink" : "teal",
        });
      }
    });
    setBubbles(allBubbles);
    const timer = setTimeout(() => setBubbles([]), 5000);
    return () => clearTimeout(timer);
  }, [active]);

  if (bubbles.length === 0) return null;

  const hueColors = {
    purple: { bg: "rgba(108,92,231,0.2)", border: "rgba(108,92,231,0.15)", glow: "rgba(108,92,231,0.2)" },
    pink: { bg: "rgba(253,121,168,0.2)", border: "rgba(253,121,168,0.15)", glow: "rgba(253,121,168,0.2)" },
    teal: { bg: "rgba(85,239,196,0.2)", border: "rgba(85,239,196,0.15)", glow: "rgba(85,239,196,0.2)" },
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 10 }}>
      {bubbles.map((b) => {
        const c = hueColors[b.hue];
        return (
          <div key={b.id} style={{
            position: "absolute",
            left: `${b.startX}%`, top: `${b.startY}%`,
            width: b.size, height: b.size, borderRadius: "50%",
            background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7), ${c.bg})`,
            border: `1px solid ${c.border}`,
            boxShadow: `0 0 ${b.size * 0.8}px ${c.glow}, inset 0 1px 3px rgba(255,255,255,0.5)`,
            animation: `bubbleBurst ${b.duration}s cubic-bezier(0.22,0.8,0.36,1) ${b.delay}s both`,
            "--endX": `${b.endX - b.startX}vw`,
            "--endY": `${b.endY - b.startY}vh`,
            "--midX": `${(b.endX - b.startX) * 0.6}vw`,
            "--midY": `${(b.endY - b.startY) * 0.3 - 15}vh`,
          }} />
        );
      })}
    </div>
  );
}

/* ─── PHASE SECTION (FULL / UNLOCKED) ─── */
function PhaseSection({ phase, index, goal, checkedMilestones, onToggleMilestone, canBreakdown, onUseCredit, onBuyBreakdown }) {
  const [ref, inView] = useInView();
  const mob = useIsMobile();
  const isEven = index % 2 === 0;
  const [breakdownMode, setBreakdownMode] = useState(null);
  const [breakdownData, setBreakdownData] = useState(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState(null);
  const [showBreakdownChoice, setShowBreakdownChoice] = useState(false);
  const [celebrated, setCelebrated] = useState(false);

  // Phase completion detection
  const phaseComplete = phase.milestones.every((_, i) => checkedMilestones[`${index}-${i}`]);
  const prevComplete = useRef(false);

  useEffect(() => {
    if (phaseComplete && !prevComplete.current && !celebrated) {
      setCelebrated(true);
      playCelebration();
    }
    prevComplete.current = phaseComplete;
  }, [phaseComplete, celebrated]);

  const handleBreakdown = async (mode) => {
    if (onUseCredit) onUseCredit();
    setBreakdownMode(mode);
    setShowBreakdownChoice(false);
    setBreakdownLoading(true);
    setBreakdownError(null);
    try {
      const data = await breakdownPhase(goal, phase, mode);
      setBreakdownData(data);
      playBreakdownDone();
    } catch (e) {
      console.error("Breakdown error:", e);
      setBreakdownError(e.message || "Failed to break down. Try again.");
    }
    setBreakdownLoading(false);
  };

  return (
    <section ref={ref} style={{
      minHeight: mob ? "auto" : "100vh", display: "flex", flexDirection: "column",
      justifyContent: "center", padding: mob ? "40px 0" : "80px 0", position: "relative",
    }}>
      {/* Celebration bubbles */}
      <BubbleCelebration active={celebrated && phaseComplete} />

      <div style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)",
        right: isEven ? -20 : "auto", left: isEven ? "auto" : -20,
        fontFamily: H, fontSize: "clamp(180px, 22vw, 280px)", fontWeight: 400,
        color: phaseComplete ? "rgba(108,92,231,0.07)" : "rgba(108,92,231,0.04)",
        lineHeight: 1, pointerEvents: "none", userSelect: "none",
        opacity: inView ? 1 : 0, transition: "all 1.5s ease",
        display: mob ? "none" : "block",
      }}>{String(index + 1).padStart(2, "0")}</div>

      <div style={{ position: "relative", zIndex: 2 }}>
        <Reveal delay={0}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <span style={{ ...M, fontSize: 11, color: ACCENT, letterSpacing: "0.12em" }}>Phase {String(index + 1).padStart(2, "0")}</span>
            <div style={{ height: 1, width: 40, background: "linear-gradient(90deg, rgba(108,92,231,0.3), transparent)" }} />
            <span style={{ ...M, fontSize: 11, color: INK25, letterSpacing: "0.06em" }}>{phase.weeks}</span>
            {phaseComplete && (
              <span style={{
                ...M, fontSize: 9, letterSpacing: "0.08em", color: "#00b894", padding: "3px 10px",
                borderRadius: 8, background: "rgba(85,239,196,0.1)", border: "1px solid rgba(85,239,196,0.2)",
                animation: "fadeIn 0.6s ease both",
              }}>Complete</span>
            )}
          </div>
        </Reveal>
        <Reveal delay={0.12}>
          <h2 style={{ fontFamily: H, fontSize: mob ? 28 : "clamp(32px, 4vw, 44px)", fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.12, marginBottom: 14, color: INK }}>
            {phase.title}
          </h2>
        </Reveal>
        <Reveal delay={0.24}>
          <p style={{ ...B, fontSize: 14, color: INK45, lineHeight: 1.7, maxWidth: 480, marginBottom: 28 }}>{phase.description}</p>
        </Reveal>

        <Reveal delay={0.36}>
          <Glass hover>
            <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: mob ? 24 : 32 }}>
              <div>
                <div style={{ ...M, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: INK25, marginBottom: 16 }}>Milestones</div>
                {phase.milestones.map((m, i) => (
                  <Milestone key={i} text={m}
                    checked={checkedMilestones[`${index}-${i}`] || false}
                    onToggle={() => onToggleMilestone(`${index}-${i}`)}
                  />
                ))}
              </div>
              <div>
                <div style={{ ...M, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: INK25, marginBottom: 16 }}>Start this week</div>
                {phase.actions.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                    <span style={{ ...M, fontSize: 11, color: ACCENT, marginTop: 2 }}>→</span>
                    <span style={{ ...B, fontSize: 13, color: INK50, lineHeight: 1.5 }}>{a}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Insight with scientific reference */}
            <Reveal delay={0.7}>
              <div style={{ marginTop: 20, padding: "14px 16px", borderRadius: 12, background: "rgba(108,92,231,0.04)", borderLeft: "2px solid rgba(108,92,231,0.15)" }}>
                <div style={{ ...M, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT, opacity: 0.5, marginBottom: 6 }}>Research insight</div>
                <span style={{ fontFamily: H, fontSize: 13, fontStyle: "italic", color: INK40, lineHeight: 1.7 }}>{phase.insight}</span>
              </div>
            </Reveal>

            {/* Side Quest */}
            {phase.sideQuest && (
              <Reveal delay={0.8}>
                <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(85,239,196,0.04)", borderLeft: "2px solid rgba(85,239,196,0.2)" }}>
                  <div style={{ ...M, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: "#00b894", opacity: 0.6, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>{Icon.bolt(10, "#00b894")} Side quest</div>
                  <span style={{ ...B, fontSize: 12, color: INK40, lineHeight: 1.6 }}>{phase.sideQuest}</span>
                </div>
              </Reveal>
            )}

            {/* Reality Check — Phase 1 only */}
            {phase.realityCheck && (
              <Reveal delay={0.9}>
                <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(253,121,168,0.04)", borderLeft: "2px solid rgba(253,121,168,0.15)" }}>
                  <div style={{ ...M, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: "#e17055", opacity: 0.6, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#e17055" strokeWidth="1.2"/><path d="M8 5v4M8 11h.01" stroke="#e17055" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Reality check
                  </div>
                  <span style={{ ...B, fontSize: 12, color: INK40, lineHeight: 1.6 }}>{phase.realityCheck}</span>
                </div>
              </Reveal>
            )}
          </Glass>
        </Reveal>

        {/* Break it down */}
        <Reveal delay={0.9}>
          <div style={{ marginTop: 20 }}>
            {!showBreakdownChoice && !breakdownData && !breakdownLoading && !breakdownError && (
              canBreakdown ? (
                <button onClick={() => setShowBreakdownChoice(true)}
                  style={{ ...M, fontSize: 10, letterSpacing: "0.06em", padding: "10px 20px", borderRadius: 12, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.5)", color: INK50, cursor: "pointer", transition: "all 0.3s ease" }}
                  onMouseEnter={(e) => { e.target.style.color = ACCENT; e.target.style.borderColor = "rgba(108,92,231,0.25)"; }}
                  onMouseLeave={(e) => { e.target.style.color = INK50; e.target.style.borderColor = "rgba(255,255,255,0.5)"; }}>
                  {Icon.loop(12, "currentColor")} Break it down {"\u2192"}
                </button>
              ) : (
                <Glass style={{ padding: "16px 20px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ ...B, fontSize: 13, color: INK50 }}>Want to go deeper?</span>
                  <button onClick={() => onBuyBreakdown("single")}
                    style={{ ...M, fontSize: 10, padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(108,92,231,0.2)", background: "rgba(108,92,231,0.06)", color: ACCENT, cursor: "pointer", transition: "all 0.3s ease" }}>
                    1 breakdown — €2
                  </button>
                  <button onClick={() => onBuyBreakdown("unlimited")}
                    style={{ ...M, fontSize: 10, padding: "8px 16px", borderRadius: 10, border: "none", background: ACCENT, color: "#fff", cursor: "pointer", transition: "all 0.3s ease" }}>
                    Unlimited — €3
                  </button>
                </Glass>
              )
            )}
            {showBreakdownChoice && (
              <Glass style={{ padding: mob ? 14 : 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ ...B, fontSize: 13, color: INK50, marginRight: 8 }}>How?</span>
                <button onClick={() => handleBreakdown("mini")}
                  style={{ ...M, fontSize: 10, padding: "8px 16px", borderRadius: 10, border: "none", background: ACCENT, color: "#fff", cursor: "pointer" }}>
                  4-step mini-roadmap
                </button>
                <button onClick={() => handleBreakdown("daily")}
                  style={{ ...M, fontSize: 10, padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(108,92,231,0.25)", background: "transparent", color: ACCENT, cursor: "pointer" }}>
                  Daily tasks
                </button>
                <button onClick={() => setShowBreakdownChoice(false)}
                  style={{ ...M, fontSize: 10, color: INK25, background: "none", border: "none", cursor: "pointer", marginLeft: 4, display: "flex", alignItems: "center" }}>{Icon.close(10, INK25)}</button>
              </Glass>
            )}
            {breakdownLoading && (
              <Glass style={{ padding: 18, display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                <div style={{ position: "relative", width: 24, height: 24 }}>
                  <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(255,255,255,0.4)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.5)", animation: "orbFloat 2s ease-in-out infinite" }} />
                  <div style={{ position: "absolute", inset: -3, animation: "orbSpin 2s linear infinite" }}>
                    <div style={{ width: 4, height: 4, borderRadius: "50%", background: ACCENT, opacity: 0.5 }} />
                  </div>
                </div>
                <span style={{ ...M, fontSize: 10, color: INK30 }}>Breaking it down...</span>
              </Glass>
            )}
            {breakdownError && (
              <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "rgba(232,93,117,0.08)", border: "1px solid rgba(232,93,117,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...B, fontSize: 13, color: "rgba(232,93,117,0.8)" }}>{breakdownError}</span>
                <button onClick={() => { setBreakdownError(null); setShowBreakdownChoice(true); }}
                  style={{ ...M, fontSize: 10, color: ACCENT, background: "none", border: "none", cursor: "pointer" }}>Retry</button>
              </div>
            )}
            {breakdownData && <BreakdownView data={breakdownData} mode={breakdownMode} onClose={() => { setBreakdownData(null); setBreakdownMode(null); }} />}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ─── LOCKED PHASE (PAYWALL) ─── */
function LockedPhase({ phase, index }) {
  return (
    <section style={{ minHeight: "30vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 0", position: "relative" }}>
      <div style={{ filter: "blur(6px)", opacity: 0.4, pointerEvents: "none", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <span style={{ ...M, fontSize: 11, color: ACCENT, letterSpacing: "0.12em" }}>Phase {String(index + 1).padStart(2, "0")}</span>
          <div style={{ height: 1, width: 40, background: "linear-gradient(90deg, rgba(108,92,231,0.3), transparent)" }} />
          <span style={{ ...M, fontSize: 11, color: INK25, letterSpacing: "0.06em" }}>{phase.weeks}</span>
        </div>
        <h2 style={{ fontFamily: H, fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1.08, marginBottom: 18, color: INK }}>{phase.title}</h2>
        <Glass style={{ height: 200 }}><div /></Glass>
      </div>
    </section>
  );
}

/* ─── QUESTION CARD ─── */
function QuestionCard({ q, index, selected, onSelect, onExtra }) {
  const [textVal, setTextVal] = useState(selected || "");
  const [showExtra, setShowExtra] = useState(false);
  const [extraText, setExtraText] = useState("");

  const extraField = showExtra ? (
    <div style={{ marginTop: 10, animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both" }}>
      <textarea value={extraText} placeholder="The more we know, the better your roadmap..."
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => { setExtraText(e.target.value); if (onExtra) onExtra(q.id, e.target.value); }}
        onFocus={(e) => { e.target.style.border = `2px solid ${ACCENT}`; e.target.style.boxShadow = "0 4px 20px rgba(108,92,231,0.18)"; }}
        onBlur={(e) => { if (!extraText.trim()) { e.target.style.border = "1.5px solid rgba(108,92,231,0.2)"; e.target.style.boxShadow = "none"; } }}
        rows={2}
        style={{
          width: "100%", background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)",
          border: extraText.trim() ? `2px solid ${ACCENT}` : "1.5px solid rgba(108,92,231,0.2)",
          borderRadius: 12, padding: "10px 14px",
          fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: INK, lineHeight: 1.5,
          resize: "none", outline: "none", transition: "all 0.3s ease",
          boxShadow: extraText.trim() ? "0 4px 20px rgba(108,92,231,0.18)" : "none",
        }} />
    </div>
  ) : (
    <button onClick={() => setShowExtra(true)}
      style={{ ...B, fontSize: 11, color: ACCENT, opacity: 0.6, background: "none", border: "none", cursor: "pointer", marginTop: 8, padding: 0, transition: "opacity 0.3s" }}
      onMouseEnter={(e) => e.target.style.opacity = 1}
      onMouseLeave={(e) => e.target.style.opacity = 0.6}>
      + Tell us more
    </button>
  );

  if (q.type === "text") {
    return (
      <div style={{ animation: `slideUp 0.7s cubic-bezier(0.16,1,0.3,1) ${0.2 + index * 0.15}s both` }}>
        <p style={{ ...B, fontSize: 15, color: INK60, lineHeight: 1.6, marginBottom: 14 }}>{q.question}</p>
        <textarea value={textVal} placeholder={q.placeholder || "Type your answer..."}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => { setTextVal(e.target.value); onSelect(q.id, e.target.value.trim(), q.question); }}
          onFocus={(e) => { e.target.style.border = `2px solid ${ACCENT}`; e.target.style.boxShadow = "0 4px 20px rgba(108,92,231,0.18)"; }}
          onBlur={(e) => { if (!textVal.trim()) { e.target.style.border = "1.5px solid rgba(108,92,231,0.2)"; e.target.style.boxShadow = "0 2px 8px rgba(0,0,0,0.03)"; } }}
          rows={3}
          style={{
            width: "100%", background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)",
            border: textVal.trim() ? `2px solid ${ACCENT}` : "1.5px solid rgba(108,92,231,0.2)",
            borderRadius: 16, padding: "14px 18px", fontFamily: "'DM Sans',sans-serif", fontSize: 14,
            color: INK, lineHeight: 1.6, resize: "none", outline: "none", transition: "all 0.3s ease",
            boxShadow: textVal.trim() ? "0 4px 20px rgba(108,92,231,0.18)" : "0 2px 8px rgba(0,0,0,0.03)",
          }} />
      </div>
    );
  }

  if (q.type === "multi_select") {
    const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    const toggle = (opt) => {
      const next = selectedArr.includes(opt) ? selectedArr.filter((o) => o !== opt) : [...selectedArr, opt];
      onSelect(q.id, next, q.question);
    };
    return (
      <div style={{ animation: `slideUp 0.7s cubic-bezier(0.16,1,0.3,1) ${0.2 + index * 0.15}s both` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
          <p style={{ ...B, fontSize: 15, color: INK60, lineHeight: 1.6 }}>{q.question}</p>
          <span style={{ ...M, fontSize: 9, color: INK25, letterSpacing: "0.06em", flexShrink: 0 }}>pick multiple</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {q.options && q.options.map((opt) => {
            const isSel = selectedArr.includes(opt);
            return (<button key={opt} onClick={() => toggle(opt)}
              style={{ ...B, fontSize: 13, padding: "10px 18px", borderRadius: 14, border: "none", cursor: "pointer", transition: "all 0.3s ease", background: isSel ? ACCENT : "rgba(255,255,255,0.5)", color: isSel ? "#fff" : INK45, backdropFilter: isSel ? "none" : "blur(12px)", boxShadow: isSel ? "0 4px 16px rgba(108,92,231,0.25)" : "0 2px 8px rgba(0,0,0,0.03)", fontWeight: isSel ? 600 : 400 }}>
              {opt}
            </button>);
          })}
        </div>
        {extraField}
    </div>
  );
  }

  // Default: single select
  return (
    <div style={{ animation: `slideUp 0.7s cubic-bezier(0.16,1,0.3,1) ${0.2 + index * 0.15}s both` }}>
      <p style={{ ...B, fontSize: 15, color: INK60, lineHeight: 1.6, marginBottom: 14 }}>{q.question}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {q.options && q.options.map((opt) => {
          const isSel = selected === opt;
          return (<button key={opt} onClick={() => onSelect(q.id, opt, q.question)}
            style={{ ...B, fontSize: 13, padding: "10px 18px", borderRadius: 14, border: "none", cursor: "pointer", transition: "all 0.3s ease", background: isSel ? ACCENT : "rgba(255,255,255,0.5)", color: isSel ? "#fff" : INK45, backdropFilter: isSel ? "none" : "blur(12px)", boxShadow: isSel ? "0 4px 16px rgba(108,92,231,0.25)" : "0 2px 8px rgba(0,0,0,0.03)", fontWeight: isSel ? 600 : 400 }}>
            {opt}
          </button>);
        })}
      </div>
      {extraField}
    </div>
  );
}

/* ─── SOCIAL PROOF TICKER ─── */
const TICKER_TEXT = "Sophie took her first step towards learning to code with Paso · Marcus started his journey to launching a startup with Paso · Ama began her path to running a marathon with Paso · Liam took his first step towards becoming a UX designer with Paso · Priya started her journey into data science with Paso · Noah began building passive income with Paso · Chloe took her first step towards writing a novel with Paso · James started his career switch to tech with Paso · Yuki began mastering photography with Paso · Diana took her first step towards starting a fashion brand with Paso · ";

function SocialTicker() {
  return (
    <div style={{ overflow: "hidden", whiteSpace: "nowrap", maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)" }}>
      <div style={{ display: "inline-block", animation: "tickerScroll 180s linear infinite" }}>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "rgba(26,26,46,0.35)", letterSpacing: "0.01em" }}>{TICKER_TEXT}</span>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "rgba(26,26,46,0.35)", letterSpacing: "0.01em" }}>{TICKER_TEXT}</span>
      </div>
    </div>
  );
}

/* ─── EXAMPLE ROADMAP PREVIEWS ─── */
const EXAMPLE_PREVIEWS = {
  "Run a half marathon": {
    goal: "Run a half marathon",
    timeline: "16 weeks",
    color: "#55efc4",
    tagline: "From first steps to finish line",
    phases: ["Build your base", "Increase distance", "Speed & endurance", "Taper & race day"],
    phase1: {
      title: "Build your base",
      description: "The first 4 weeks are about building a consistent running habit and getting your body used to impact. No speed, no pressure — just showing up.",
      milestones: [
        "Complete 3 easy runs of 3–4 km this week",
        "Run 5K without stopping",
        "Establish a pre-run warm-up routine",
        "Log your runs in a tracking app",
        "Complete 2 rest-day walks of 30+ minutes",
      ],
      insight: "A 2019 study in the British Journal of Sports Medicine found that runners who built mileage gradually (< 10% per week increase) had 72% fewer injuries than those who ramped up quickly.",
      sideQuest: "Find a local running group or accountability partner — runners with social support are 3x more likely to maintain their habit past 8 weeks.",
      realityCheck: "Most people overestimate their starting fitness. If you can't run 2 km comfortably today, add 2 weeks of walk-run intervals before this phase. There's no shame in that — it's how most marathon runners actually started.",
    },
  },
  "Launch a startup": {
    goal: "Launch a startup",
    timeline: "24 weeks",
    color: "#a29bfe",
    tagline: "From idea to first paying customer",
    phases: ["Validate your idea", "Build the MVP", "Find first users", "Grow & iterate"],
    phase1: {
      title: "Validate your idea",
      description: "Before you build anything, make sure someone actually wants it. This phase is about talking to real people and stress-testing your assumptions.",
      milestones: [
        "Interview 10 potential customers this week",
        "Define your unique value proposition in one sentence",
        "Identify 3 direct competitors and their weaknesses",
        "Write a one-page problem statement",
        "Get 5 people to say 'I'd pay for that'",
      ],
      insight: "According to CB Insights, 35% of startups fail because there's no market need. Customer interviews before building reduce this risk dramatically.",
      sideQuest: "Create a simple landing page with just a headline and email signup. If you can get 50 signups in 2 weeks with zero product, you're onto something real.",
      realityCheck: "90% of startups fail. That's not meant to scare you — it's meant to make you obsess over validation. The founders who succeed aren't luckier; they just killed bad ideas faster and moved on to better ones.",
    },
  },
  "Become a model": {
    goal: "Become a model",
    timeline: "12 weeks",
    color: "#fd79a8",
    tagline: "From aspiration to representation",
    phases: ["Build your portfolio", "Find representation", "Book first jobs", "Build your brand"],
    phase1: {
      title: "Build your portfolio",
      description: "Agencies don't want perfection — they want potential. This phase is about creating a clean, professional portfolio that shows your range and lets your look speak.",
      milestones: [
        "Research 5 agencies in your city and their submission requirements",
        "Schedule a professional test shoot with a photographer",
        "Get 8–12 strong portfolio shots in different looks",
        "Take accurate measurements and create a comp card",
        "Practice 3 signature poses in front of a mirror daily",
      ],
      insight: "Ford Models founder Eileen Ford famously said agencies look for 'bone structure and personality, not perfection.' Most successful models were scouted or signed with minimal experience.",
      sideQuest: "Follow 10 working models in your category on Instagram. Study their portfolios — notice how simple the best comp cards are. Less is always more at the start.",
      realityCheck: "The industry is subjective and full of rejection. You will hear 'no' far more than 'yes' — even top models get rejected constantly. Your job isn't to be everyone's type. It's to find the agencies and brands where your specific look is exactly what they need.",
    },
  },
};

/* ─── MAIN ─── */
export default function PasoLive() {
  const mob = useIsMobile();
  const [inputValue, setInputValue] = useState("");
  const [step, setStep] = useState("landing");
  const [questions, setQuestions] = useState(null);
  const [questionsIntro, setQuestionsIntro] = useState("");
  const [answers, setAnswers] = useState({});
  const [extras, setExtras] = useState({});
  const [previewExample, setPreviewExample] = useState(null);
  const [previewChecked, setPreviewChecked] = useState({});
  const [previewClosing, setPreviewClosing] = useState(false);

  const closePreview = () => {
    setPreviewClosing(true);
    setTimeout(() => { setPreviewExample(null); setPreviewClosing(false); setPreviewChecked({}); }, 300);
  };
  const [roadmap, setRoadmap] = useState(null);
  const [error, setError] = useState(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activePhase, setActivePhase] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [goal, setGoal] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [breakdownCredits, setBreakdownCredits] = useState(0); // 0 = none, -1 = unlimited
  const [checkedMilestones, setCheckedMilestones] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [shareId, setShareId] = useState(null);
  const [shareStatus, setShareStatus] = useState(""); // "", "saving", "copied", "error"
  const [isSharedView, setIsSharedView] = useState(false);
  const phaseRefs = useRef([]);

  // Check URL for shared roadmap on mount
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/#\/r\/([a-z0-9]+)/);
    if (match) {
      const id = match[1];
      setStep("loadingR");
      loadRoadmap(id).then((data) => {
        setRoadmap(data.roadmap);
        setGoal(data.goal);
        setShareId(id);
        setIsSharedView(true);
        setUnlocked(true);
        setStep("roadmap");
      }).catch(() => {
        setError("This roadmap link is invalid or has expired.");
        setStep("landing");
        window.location.hash = "";
      });
    }
  }, []);

  // Init audio on toggle
  const toggleSound = useCallback(async () => {
    if (!soundEnabled) {
      await initAudio();
      setSoundEnabled(true);
      startAmbient();
    } else {
      stopAmbient();
      setSoundEnabled(false);
    }
  }, [soundEnabled]);

  // Loading messages + progress fill
  useEffect(() => {
    if (step !== "loadingQ" && step !== "loadingR") return;
    const msgs = step === "loadingQ"
      ? ["Understanding your goal", "Thinking about what matters", "Crafting smart questions"]
      : ["Structuring your phases", "Researching evidence", "Finding scientific references", "Designing milestones", "Adding side quests", "Personalizing everything"];
    let i = 0;
    setLoadingMsg(msgs[0]);
    setLoadingProgress(0);
    const msgInterval = setInterval(() => { i++; setLoadingMsg(msgs[i % msgs.length]); }, 3800);
    // Simulate progress: fast at start, slows down, never hits 100 until done
    const progInterval = setInterval(() => {
      setLoadingProgress((p) => {
        if (p < 60) return p + 3 + Math.random() * 4;
        if (p < 85) return p + 0.8 + Math.random() * 1.5;
        if (p < 94) return p + 0.2 + Math.random() * 0.5;
        return p; // stall near 94
      });
    }, 300);
    return () => { clearInterval(msgInterval); clearInterval(progInterval); };
  }, [step]);

  // When step changes TO roadmap or questions, play sounds
  useEffect(() => {
    if (step === "questions") {
      setLoadingProgress(100);
      if (soundEnabled) startAmbient();
    }
    if (step === "roadmap") {
      setLoadingProgress(100);
      if (soundEnabled) { playRevealChime(); startAmbient(); }
    }
    if (step === "landing") stopAmbient();
  }, [step, soundEnabled]);

  // Scroll tracking
  useEffect(() => {
    if (step !== "roadmap") return;
    const onScroll = () => {
      const top = window.scrollY;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(h > 0 ? top / h : 0);
      phaseRefs.current.forEach((ref, i) => {
        if (ref) {
          const r = ref.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.3) setActivePhase(i);
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [step]);

  const allAnswered = questions && questions.every((q) => {
    const a = answers[q.id];
    if (!a) return false;
    if (q.type === "text") return typeof a.answer === "string" && a.answer.trim().length > 0;
    if (q.type === "multi_select") return Array.isArray(a.answer) && a.answer.length > 0;
    return true;
  });

  const handleGoal = async () => {
    if (!inputValue.trim()) return;
    if (soundEnabled) initAudio();
    setGoal(inputValue.trim()); setStep("loadingQ"); setError(null);
    try {
      const data = await generateQuestions(inputValue.trim());
      setQuestions(data.questions); setQuestionsIntro(data.intro); setStep("questions");
    } catch (err) { setError(err.message); setStep("landing"); }
  };

  const handleAnswer = (id, answer, question) => {
    setAnswers((p) => ({ ...p, [id]: { answer, question } }));
  };

  const handleExtra = (id, text) => {
    setExtras((p) => ({ ...p, [id]: text }));
  };

  const handleGenerate = async () => {
    if (!allAnswered) return;
    setStep("loadingR"); setError(null);
    try {
      const data = await generateRoadmap(goal, Object.values(answers), extras);
      setRoadmap(data); setStep("roadmap"); window.scrollTo(0, 0);
    } catch (err) { setError(err.message); setStep("questions"); }
  };

  const handleReset = () => {
    setStep("landing"); setRoadmap(null); setQuestions(null); setAnswers({}); setExtras({});
    setInputValue(""); setGoal(""); setError(null); setUnlocked(false);
    setBreakdownCredits(0); setCheckedMilestones({}); setShowFinale(false);
    setFinaleTriggered(false); setShareId(null); setShareStatus(""); setIsSharedView(false);
    milestoneTickCount = 0; window.scrollTo(0, 0);
    if (window.location.hash) window.location.hash = "";
  };

  const handleShare = async () => {
    if (shareId) {
      const link = `${window.location.origin}${window.location.pathname}#/r/${shareId}`;
      await navigator.clipboard.writeText(link);
      setShareStatus("copied");
      setTimeout(() => setShareStatus(""), 2500);
      return;
    }
    setShareStatus("saving");
    try {
      const id = await saveRoadmap(roadmap, Object.values(answers), goal);
      setShareId(id);
      const link = `${window.location.origin}${window.location.pathname}#/r/${id}`;
      window.location.hash = `/r/${id}`;
      await navigator.clipboard.writeText(link);
      setShareStatus("copied");
      setTimeout(() => setShareStatus(""), 2500);
    } catch (e) {
      setShareStatus("error");
      setTimeout(() => setShareStatus(""), 2500);
    }
  };

  const handleUnlock = () => {
    if (soundEnabled) playUnlockSound();
    setUnlocked(true);
  };

  const handleBuyBreakdown = (type) => {
    if (soundEnabled) playUnlockSound();
    if (type === "single") setBreakdownCredits((c) => c === -1 ? -1 : c + 1);
    else setBreakdownCredits(-1); // unlimited
  };

  const canBreakdown = breakdownCredits === -1 || breakdownCredits > 0;
  const useBreakdownCredit = () => {
    if (breakdownCredits > 0) setBreakdownCredits((c) => c - 1);
  };

  const toggleMilestone = useCallback((key) => {
    setCheckedMilestones((p) => {
      const wasChecked = p[key];
      if (!wasChecked && soundEnabled) playMilestoneTick();
      return { ...p, [key]: !wasChecked };
    });
  }, [soundEnabled]);

  const totalMilestones = roadmap ? roadmap.phases.reduce((s, p) => s + p.milestones.length, 0) : 0;
  const checkedCount = Object.values(checkedMilestones).filter(Boolean).length;
  const allComplete = totalMilestones > 0 && checkedCount === totalMilestones;
  const [showFinale, setShowFinale] = useState(false);
  const [finaleTriggered, setFinaleTriggered] = useState(false);

  // Detect all-complete
  useEffect(() => {
    if (allComplete && !finaleTriggered) {
      setFinaleTriggered(true);
      setTimeout(() => {
        setShowFinale(true);
        if (soundEnabled) playCelebration();
      }, 600);
    }
  }, [allComplete, finaleTriggered, soundEnabled]);

  // Beautiful PDF export
  const exportPDF = () => {
    if (!roadmap) return;

    // Build progress dots separately to avoid nested template literals
    let progressDots = "";
    roadmap.phases.forEach((p, i) => {
      p.milestones.forEach((_, j) => {
        const key = i + "-" + j;
        const cls = checkedMilestones[key] ? "progress-dot done" : "progress-dot";
        progressDots += '<div class="' + cls + '"></div>';
      });
    });

    const phases = roadmap.phases.map((p, i) => {
      const milestoneHtml = p.milestones.map((m, j) => {
        const key = i + "-" + j;
        const done = checkedMilestones[key];
        const cls = done ? "milestone done" : "milestone";
        const check = done ? "&#10003;" : "";
        return '<div class="' + cls + '"><span class="check">' + check + "</span>" + m + "</div>";
      }).join("");
      const actionHtml = p.actions.map((a) => '<div class="action">' + a + "</div>").join("");
      const sqHtml = p.sideQuest ? '<div class="sidequest"><span class="sq-label">Side quest</span>' + p.sideQuest + "</div>" : "";
      const rcHtml = p.realityCheck ? '<div class="realitycheck"><span class="rc-label">Reality check</span>' + p.realityCheck + "</div>" : "";

      return '<div class="phase"><div class="phase-num">Phase ' + String(i + 1).padStart(2, "0") + '</div><h2>' + p.title + '</h2><div class="phase-meta">' + p.weeks + '</div><p class="desc">' + p.description + '</p><div class="section-label">Milestones</div>' + milestoneHtml + '<div class="section-label" style="margin-top:18px">Actions</div>' + actionHtml + '<div class="insight"><span class="insight-label">Research-backed insight</span>' + p.insight + '</div>' + sqHtml + rcHtml + '</div>';
    }).join('<div class="divider"></div>');

    const quoteHtml = roadmap.closingQuote
      ? '<div class="quote-section"><div class="quote-divider"></div><div class="quote">"' + roadmap.closingQuote + '"</div><div class="quote-author">— ' + (roadmap.closingQuoteAuthor || "Unknown") + '</div></div>'
      : "";

    const html = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Paso Roadmap</title>',
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">',
      "<style>",
      "@page{margin:48px 56px;size:A4}*{box-sizing:border-box;margin:0;padding:0}",
      "body{font-family:'DM Sans',sans-serif;color:#1a1a2e;line-height:1.7;background:#fff;padding:48px 56px}",
      ".brand{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#6C5CE7;opacity:0.6;margin-bottom:8px}",
      "h1{font-family:'Playfair Display',serif;font-size:32px;font-weight:400;letter-spacing:-0.03em;line-height:1.15;margin-bottom:8px}",
      ".tagline{font-family:'Playfair Display',serif;font-size:16px;font-style:italic;color:rgba(26,26,46,0.35);margin-bottom:6px}",
      ".summary{font-size:13px;color:rgba(26,26,46,0.45);max-width:460px;margin-bottom:8px}",
      ".meta{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(26,26,46,0.3);letter-spacing:0.06em;margin-bottom:32px}",
      ".progress-bar{display:flex;gap:3px;margin-bottom:32px}",
      ".progress-dot{width:8px;height:8px;border-radius:2px;background:rgba(26,26,46,0.06)}",
      ".progress-dot.done{background:#6C5CE7}",
      ".divider{height:1px;background:linear-gradient(90deg,transparent,rgba(26,26,46,0.06),transparent);margin:32px 0}",
      ".phase{page-break-inside:avoid}",
      ".phase-num{font-family:'JetBrains Mono',monospace;font-size:10px;color:#6C5CE7;letter-spacing:0.12em;margin-bottom:4px}",
      ".phase h2{font-family:'Playfair Display',serif;font-size:24px;font-weight:400;letter-spacing:-0.02em;margin-bottom:4px}",
      ".phase-meta{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(26,26,46,0.3);margin-bottom:12px}",
      ".desc{font-size:13px;color:rgba(26,26,46,0.5);margin-bottom:18px;max-width:460px}",
      ".section-label{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(26,26,46,0.25);margin-bottom:10px}",
      ".milestone{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;font-size:13px;color:rgba(26,26,46,0.6)}",
      ".milestone.done{color:rgba(26,26,46,0.25);text-decoration:line-through}",
      ".check{width:14px;height:14px;border-radius:4px;border:1.5px solid rgba(108,92,231,0.25);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#6C5CE7;margin-top:2px}",
      ".milestone.done .check{background:#6C5CE7;color:#fff;border:none}",
      ".action{font-size:12px;color:rgba(26,26,46,0.5);margin-bottom:6px;padding-left:12px;border-left:2px solid rgba(108,92,231,0.12)}",
      ".insight{margin-top:16px;padding:12px 16px;border-radius:10px;background:rgba(108,92,231,0.03);font-family:'Playfair Display',serif;font-size:13px;font-style:italic;color:rgba(26,26,46,0.5);line-height:1.7}",
      ".insight-label{display:block;font-family:'JetBrains Mono',monospace;font-size:8px;font-style:normal;letter-spacing:0.14em;text-transform:uppercase;color:#6C5CE7;opacity:0.6;margin-bottom:6px}",
      ".sidequest{margin-top:10px;padding:10px 16px;border-radius:10px;background:rgba(85,239,196,0.04);border-left:2px solid rgba(85,239,196,0.2);font-size:12px;color:rgba(26,26,46,0.5)}",
      ".sq-label{display:block;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:#00b894;opacity:0.7;margin-bottom:4px}",
      ".realitycheck{margin-top:10px;padding:10px 16px;border-radius:10px;background:rgba(253,121,168,0.04);border-left:2px solid rgba(253,121,168,0.15);font-size:12px;color:rgba(26,26,46,0.5)}",
      ".rc-label{display:block;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:#e17055;opacity:0.7;margin-bottom:4px}",
      ".quote-section{text-align:center;padding:40px 0 24px;page-break-inside:avoid}",
      ".quote-divider{width:24px;height:1px;background:rgba(108,92,231,0.15);margin:0 auto 20px}",
      ".quote{font-family:'Playfair Display',serif;font-size:16px;font-style:italic;color:rgba(26,26,46,0.3);line-height:1.7;max-width:380px;margin:0 auto 8px}",
      ".quote-author{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.1em;color:rgba(26,26,46,0.22);text-transform:uppercase}",
      ".footer{text-align:center;font-family:'JetBrains Mono',monospace;font-size:8px;color:rgba(26,26,46,0.08);letter-spacing:0.14em;padding-top:24px}",
      "@media print{body{padding:0}.phase{page-break-inside:avoid}}",
      "</style></head><body>",
      '<div class="brand">Paso</div>',
      "<h1>" + roadmap.goal + "</h1>",
      '<div class="tagline">' + roadmap.tagline + "</div>",
      '<div class="summary">' + roadmap.summary + "</div>",
      '<div class="meta">' + roadmap.timeline + " · " + checkedCount + "/" + totalMilestones + " milestones complete</div>",
      '<div class="progress-bar">' + progressDots + "</div>",
      phases,
      quoteHtml,
      '<div class="footer">PASO</div>',
      "</body></html>",
    ].join("\n");

    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  // Start day one — scroll to Phase 1 and flash
  const startDayOne = () => {
    if (phaseRefs.current[0]) {
      phaseRefs.current[0].scrollIntoView({ behavior: "smooth", block: "start" });
      // Flash highlight on first phase
      setTimeout(() => {
        const el = phaseRefs.current[0];
        if (el) {
          el.style.transition = "box-shadow 0.8s ease";
          el.style.boxShadow = "0 0 80px rgba(108,92,231,0.12)";
          setTimeout(() => { el.style.boxShadow = "none"; }, 2000);
        }
      }, 800);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #e8dff5 0%, #f5e6d3 15%, #d4e4f7 35%, #f0d9e8 55%, #dbecd4 75%, #e8dff5 100%)",
      backgroundAttachment: mob ? "scroll" : "fixed", color: INK, fontFamily: "'DM Sans', sans-serif", position: "relative",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}body{background:#e8dff5}
        ::selection{background:rgba(108,92,231,0.2);color:#1a1a2e}
        input::placeholder,textarea::placeholder{color:rgba(26,26,46,0.22)}
        input,textarea,select{font-size:16px!important}
        button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(36px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes float0{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-25px,18px) scale(1.03)}}
        @keyframes float1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(18px,-22px) scale(0.97)}}
        @keyframes float2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-12px,12px) scale(1.02)}}
        @keyframes orbPulse{0%,100%{transform:scale(1);opacity:0.5}50%{transform:scale(1.15);opacity:1}}
        @keyframes orbFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes orbDrift{0%,100%{transform:translate(0,0)}50%{transform:translate(-4px,3px)}}
        @keyframes orbSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes tickerScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes fadeOut{from{opacity:1}to{opacity:0}}
        @keyframes slideDown{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(24px)}}
        @keyframes bubbleBurst{0%{transform:translate(0,0) scale(0);opacity:0}12%{transform:translate(calc(var(--midX) * 0.4),calc(var(--midY) * 0.4)) scale(1.1);opacity:1}50%{transform:translate(var(--midX),var(--midY)) scale(1);opacity:0.9}80%{opacity:0.4}100%{transform:translate(var(--endX),var(--endY)) scale(0.3);opacity:0}}
      `}</style>

      {/* Ambient */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-8%", right: "5%", width: mob ? 280 : 500, height: mob ? 280 : 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(108,92,231,0.18), transparent 70%)", filter: "blur(80px)", animation: "float0 14s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "5%", left: "-5%", width: mob ? 250 : 450, height: mob ? 250 : 450, borderRadius: "50%", background: "radial-gradient(circle, rgba(253,121,168,0.15), transparent 70%)", filter: "blur(80px)", animation: "float1 16s ease-in-out 2s infinite" }} />
        <div style={{ position: "absolute", top: "35%", left: "40%", width: mob ? 200 : 350, height: mob ? 200 : 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(85,239,196,0.1), transparent 70%)", filter: "blur(80px)", animation: "float2 12s ease-in-out 4s infinite" }} />
      </div>

      {/* Progress */}
      {step === "roadmap" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, zIndex: 100, background: "rgba(108,92,231,0.08)" }}>
          <div style={{ height: "100%", width: `${scrollProgress * 100}%`, background: `linear-gradient(90deg, ${ACCENT}, #a29bfe)`, transition: "width 0.1s linear" }} />
        </div>
      )}

      {/* Side nav — desktop only */}
      {step === "roadmap" && roadmap && unlocked && !mob && (
        <nav style={{ position: "fixed", right: 28, top: "50%", transform: "translateY(-50%)", zIndex: 50, display: "flex", flexDirection: "column", gap: 12, animation: "fadeIn 1s ease 1s both" }}>
          {roadmap.phases.map((_, i) => (
            <button key={i} onClick={() => phaseRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" })}
              style={{ width: activePhase === i ? 24 : 14, height: 3, borderRadius: 2, border: "none", cursor: "pointer", padding: 0, background: activePhase === i ? ACCENT : "rgba(26,26,46,0.08)", transition: "all 0.5s cubic-bezier(0.16,1,0.3,1)" }} />
          ))}
        </nav>
      )}

      <div style={{ position: "relative", zIndex: 2, maxWidth: 760, margin: "0 auto", padding: mob ? "0 18px" : "0 40px" }}>
        {/* Header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0", animation: "fadeIn 0.8s ease both" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" }} onClick={handleReset}>
            <span style={{ fontFamily: H, fontSize: 21, fontWeight: 500, color: INK }}>Paso</span>
            <span style={{ ...M, fontSize: 8, color: INK22, letterSpacing: "0.06em", fontStyle: "italic" }}>Spanish for step</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Sound toggle */}
            <button onClick={toggleSound}
              style={{
                ...M, fontSize: 9, letterSpacing: "0.06em", color: soundEnabled ? ACCENT : INK25,
                background: "none", border: "none", cursor: "pointer", transition: "color 0.3s",
                display: "flex", alignItems: "center", gap: 5,
              }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 6h2l3-3v10L5 10H3a1 1 0 01-1-1V7a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                {soundEnabled ? (
                  <>
                    <path d="M11 5.5a3 3 0 010 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <path d="M13 3.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </>
                ) : (
                  <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                )}
              </svg>
            </button>
            {step !== "landing" && (
              <button onClick={handleReset} style={{ ...M, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: INK25, background: "none", border: "none", cursor: "pointer", transition: "color 0.3s" }}
                onMouseEnter={(e) => (e.target.style.color = ACCENT)} onMouseLeave={(e) => (e.target.style.color = INK25)}>
                ← Start over
              </button>
            )}
          </div>
        </header>
        <div style={{ height: 1, background: "rgba(26,26,46,0.05)" }} />

        {/* ━━━ LANDING ━━━ */}
        {step === "landing" && (
          <div style={{ paddingTop: mob ? "10vh" : "16vh", paddingBottom: mob ? "8vh" : "12vh" }}>

            {/* ── Hero ── */}
            <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.1s both" }}>
              <div style={{ ...M, fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: ACCENT, opacity: 0.55, marginBottom: 28 }}>
                AI-powered roadmaps, one step at a time
              </div>
            </div>
            <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.25s both" }}>
              <h1 style={{ fontFamily: H, fontSize: "clamp(44px, 6vw, 70px)", fontWeight: 400, lineHeight: 1.08, letterSpacing: "-0.03em", maxWidth: 560, marginBottom: 28, color: INK }}>
                Every ambition<br />starts with a <em style={{ fontStyle: "italic", color: ACCENT }}>step</em>.
              </h1>
            </div>
            <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.4s both" }}>
              <p style={{ ...B, fontSize: 16, color: INK50, lineHeight: 1.8, maxWidth: 440, marginBottom: 52 }}>
                Your goal. A few smart questions. A step-by-step roadmap you can actually follow.
              </p>
            </div>

            {/* ── Input ── */}
            <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.55s both" }}>
              <Glass style={{ maxWidth: 520, padding: mob ? "14px 16px" : "18px 22px", display: "flex", flexDirection: mob ? "column" : "row", alignItems: mob ? "stretch" : "center", gap: mob ? 10 : 14 }}>
                <input type="text" placeholder="I want to..." value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleGoal()}
                  style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: INK, padding: mob ? "8px 0" : 0 }} />
                <button onClick={handleGoal} disabled={!inputValue.trim()}
                  style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: mob ? "13px 22px" : "11px 22px", borderRadius: 12, border: "none", cursor: inputValue.trim() ? "pointer" : "default", background: inputValue.trim() ? ACCENT : "rgba(26,26,46,0.06)", color: inputValue.trim() ? "#fff" : "rgba(26,26,46,0.2)", fontWeight: 500, transition: "all 0.3s ease", whiteSpace: "nowrap" }}>
                  Take the first step
                </button>
              </Glass>
              {error && (
                <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(232,93,117,0.08)", border: "1px solid rgba(232,93,117,0.15)" }}>
                  <span style={{ ...B, fontSize: 13, color: "rgba(232,93,117,0.8)" }}>{error}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                {["Launch a startup", "Become a model", "Learn ML", "Buy investment property", "Run a half marathon"].map((s) => (
                  <button key={s} onClick={() => setInputValue(s.toLowerCase())}
                    style={{ ...B, fontSize: 12, color: INK22, background: "rgba(255,255,255,0.35)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 20, padding: "5px 14px", cursor: "pointer", transition: "all 0.3s ease" }}
                    onMouseEnter={(e) => { e.target.style.color = ACCENT; e.target.style.borderColor = "rgba(108,92,231,0.25)"; }}
                    onMouseLeave={(e) => { e.target.style.color = INK22; e.target.style.borderColor = "rgba(255,255,255,0.4)"; }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Example Roadmaps ── */}
            <div style={{ marginTop: mob ? "14vh" : "18vh", animation: "fadeIn 1.5s ease 0.8s both" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
                {["4 phases", "Research-backed", "Break-it-down mode", "PDF export"].map((f) => (
                  <span key={f} style={{ ...M, fontSize: 9, letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 8, background: "rgba(108,92,231,0.05)", color: INK25 }}>{f}</span>
                ))}
              </div>
              <div style={{ ...M, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: ACCENT, opacity: 0.5, marginBottom: 16 }}>
                See what Paso creates
              </div>
              <p style={{ ...B, fontSize: 15, color: INK45, lineHeight: 1.7, maxWidth: 420, marginBottom: 40 }}>
                Real roadmaps, generated in seconds. Each one is personalized, research-backed, and broken into actionable steps.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr 1fr", gap: mob ? 16 : 20 }}>
                {[
                  EXAMPLE_PREVIEWS["Run a half marathon"],
                  EXAMPLE_PREVIEWS["Launch a startup"],
                  EXAMPLE_PREVIEWS["Become a model"],
                ].map((ex) => (
                  <button key={ex.goal} onClick={() => setPreviewExample(ex)}
                    style={{ textAlign: "left", cursor: "pointer", background: "rgba(255,255,255,0.45)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)", borderRadius: 20, padding: mob ? "20px" : "24px", transition: "all 0.4s ease" }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,0.06)"; e.currentTarget.style.borderColor = "rgba(108,92,231,0.2)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: ex.color, flexShrink: 0 }} />
                      <span style={{ ...M, fontSize: 9, color: INK25, letterSpacing: "0.06em" }}>{ex.timeline}</span>
                    </div>
                    <div style={{ fontFamily: H, fontSize: 17, fontWeight: 500, color: INK, marginBottom: 16, lineHeight: 1.3 }}>{ex.goal}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                      {ex.phases.map((p, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ ...M, fontSize: 9, color: ACCENT, opacity: 0.5 }}>{String(i + 1).padStart(2, "0")}</span>
                          <span style={{ ...B, fontSize: 12, color: INK40 }}>{p}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ borderTop: "1px solid rgba(26,26,46,0.05)", paddingTop: 12 }}>
                      {ex.phase1.milestones.slice(0, 2).map((m, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                          <div style={{ width: 12, height: 12, borderRadius: 4, border: "1.5px solid rgba(108,92,231,0.25)", flexShrink: 0, marginTop: 2 }} />
                          <span style={{ ...B, fontSize: 11, color: INK30, lineHeight: 1.5 }}>{m}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 14, ...M, fontSize: 9, color: ACCENT, letterSpacing: "0.04em", opacity: 0.7 }}>Preview Phase 1 →</div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Social proof ── */}
            <div style={{ marginTop: mob ? "14vh" : "18vh", animation: "fadeIn 1.5s ease 1s both" }}>
              <SocialTicker />
            </div>

            {/* ── Counter + Footer ── */}
            <div style={{ marginTop: mob ? "14vh" : "18vh", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", animation: "fadeIn 1.5s ease 1.2s both" }}>
              <Glass style={{ padding: mob ? "28px 32px" : "32px 40px", display: "flex", alignItems: "center", gap: 18, marginBottom: 72 }}>
                <span style={{ fontFamily: H, fontSize: 36, fontWeight: 400, color: INK }}>2,847</span>
                <span style={{ ...B, fontSize: 14, color: INK30, lineHeight: 1.4, textAlign: "left" }}>roadmaps<br />generated</span>
              </Glass>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <p style={{ fontFamily: H, fontSize: 14, fontStyle: "italic", color: INK30 }}>"The path is made by walking."</p>
                <span style={{ ...M, fontSize: 9, color: INK25, letterSpacing: "0.1em" }}>— Antonio Machado</span>
                <span style={{ ...M, fontSize: 9, color: INK22, letterSpacing: "0.1em", marginTop: 24 }}>PASO · 2026</span>
              </div>
            </div>
          </div>
        )}

        {/* ━━━ LOADING ━━━ */}
        {(step === "loadingQ" || step === "loadingR") && (
          <div style={{ height: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.5s ease both" }}>
            <PasoOrb progress={loadingProgress} interactive />
            <p style={{ fontFamily: H, fontSize: 24, fontStyle: "italic", color: INK30, marginTop: 36, marginBottom: 12, textAlign: "center" }}>
              {step === "loadingQ" ? "Getting to know your goal..." : "Building your roadmap..."}
            </p>
            <div key={loadingMsg} style={{ animation: "fadeIn 0.6s ease both" }}>
              <span style={{ ...B, fontSize: 13, color: INK40 }}>{loadingMsg}</span>
            </div>
            <p style={{ ...M, fontSize: 9, color: INK22, letterSpacing: "0.04em" }}>
              {step === "loadingQ" ? "This usually takes about 5 seconds" : "This usually takes about 20 seconds — worth the wait"}
            </p>
            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 120, height: 2, borderRadius: 1, background: "rgba(108,92,231,0.08)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${loadingProgress}%`, background: `linear-gradient(90deg, ${ACCENT}, #a29bfe)`, borderRadius: 1, transition: "width 0.5s cubic-bezier(0.16,1,0.3,1)" }} />
              </div>
              <span style={{ ...M, fontSize: 9, color: INK25, minWidth: 30 }}>{Math.round(loadingProgress)}%</span>
            </div>
            <Glass style={{ marginTop: 32, padding: "12px 20px", maxWidth: 340, textAlign: "center" }}>
              <span style={{ ...B, fontSize: 13, color: INK50 }}>"{goal}"</span>
            </Glass>
          </div>
        )}

        {/* ━━━ QUESTIONS ━━━ */}
        {step === "questions" && questions && (
          <div style={{ paddingTop: mob ? "6vh" : "10vh", paddingBottom: mob ? "6vh" : "10vh" }}>
            <div style={{ animation: "slideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.05s both" }}>
              <div style={{ ...M, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: ACCENT, opacity: 0.5, marginBottom: 16 }}>Let's personalize this</div>
            </div>
            <div style={{ animation: "slideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.15s both" }}>
              <h2 style={{ fontFamily: H, fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: 10, color: INK }}>{questionsIntro}</h2>
            </div>
            <div style={{ animation: "slideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.25s both" }}>
              <p style={{ ...B, fontSize: 14, color: INK45, marginBottom: 44 }}>A few quick questions so your roadmap fits your reality.</p>
            </div>
            <Glass style={{ marginBottom: 32 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                {questions.map((q, i) => (
                  <QuestionCard key={q.id} q={q} index={i} selected={answers[q.id]?.answer} onSelect={handleAnswer} onExtra={handleExtra} />
                ))}
              </div>
            </Glass>
            {error && (
              <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(232,93,117,0.08)", border: "1px solid rgba(232,93,117,0.15)" }}>
                <span style={{ ...B, fontSize: 13, color: "rgba(232,93,117,0.8)" }}>{error}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexDirection: mob ? "column" : "row", gap: mob ? 16 : 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {questions.map((q, i) => (
                  <div key={i} style={{ width: answers[q.id] ? 24 : 16, height: 3, borderRadius: 2, background: answers[q.id] ? ACCENT : "rgba(26,26,46,0.08)", transition: "all 0.4s cubic-bezier(0.16,1,0.3,1)" }} />
                ))}
                <span style={{ ...M, fontSize: 10, color: INK25, marginLeft: 8 }}>{Object.keys(answers).length}/{questions.length}</span>
              </div>
              <button onClick={handleGenerate} disabled={!allAnswered}
                style={{ ...M, fontSize: 12, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", cursor: allAnswered ? "pointer" : "default", background: allAnswered ? ACCENT : "rgba(26,26,46,0.06)", color: allAnswered ? "#fff" : "rgba(26,26,46,0.2)", fontWeight: 500, transition: "all 0.4s ease", boxShadow: allAnswered ? "0 4px 20px rgba(108,92,231,0.25)" : "none", width: mob ? "100%" : "auto" }}>
                Generate my roadmap →
              </button>
            </div>
          </div>
        )}

        {/* ━━━ ROADMAP ━━━ */}
        {step === "roadmap" && roadmap && (
          <>
            {/* Shared view banner */}
            {isSharedView && (
              <div style={{ animation: "fadeIn 0.5s ease both", marginTop: 12, marginBottom: -20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderRadius: 12, background: "rgba(108,92,231,0.04)", border: "1px solid rgba(108,92,231,0.1)" }}>
                <span style={{ ...B, fontSize: 12, color: INK30 }}>You're viewing a shared roadmap</span>
                <button onClick={() => { setIsSharedView(false); handleReset(); }}
                  style={{ ...M, fontSize: 10, letterSpacing: "0.04em", padding: "6px 14px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", cursor: "pointer" }}>
                  Make your own
                </button>
              </div>
            )}

            {/* Hero */}
            <section style={{ minHeight: mob ? "auto" : "88vh", display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: mob ? 32 : 0, paddingBottom: 40 }}>
              <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.2s both" }}>
                <div style={{ ...M, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: ACCENT, opacity: 0.5, marginBottom: 20 }}>
                  Your roadmap · {roadmap.timeline}
                </div>
              </div>
              <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.35s both" }}>
                <h1 style={{ fontFamily: H, fontSize: "clamp(44px, 6.5vw, 72px)", fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 18, color: INK }}>
                  {roadmap.goal}
                </h1>
              </div>
              <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.5s both" }}>
                <p style={{ fontFamily: H, fontSize: 18, fontStyle: "italic", color: INK25, maxWidth: 460, lineHeight: 1.6, marginBottom: 10 }}>{roadmap.tagline}</p>
              </div>
              <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.65s both" }}>
                <p style={{ ...B, fontSize: 13, color: INK25, lineHeight: 1.7, maxWidth: 460, marginBottom: 40 }}>{roadmap.summary}</p>
              </div>

              {/* Phase name pills */}
              <div style={{ display: "flex", gap: 10, animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.8s both", flexWrap: "wrap" }}>
                {roadmap.phases.map((p, i) => (
                  <div key={i} style={{
                    ...M, fontSize: 10, letterSpacing: "0.04em", padding: "10px 18px", borderRadius: 12,
                    background: "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)",
                    color: INK45, display: "flex", alignItems: "center", gap: 8,
                    opacity: !unlocked && i > 0 ? 0.5 : 1,
                  }}>
                    <span style={{ opacity: 0.4 }}>{String(i + 1).padStart(2, "0")}</span> {p.title}
                    {!unlocked && i > 0 && <span style={{ display: "flex" }}>{Icon.lock(10, INK45)}</span>}
                  </div>
                ))}
              </div>

              {/* Paywall CTA */}
              {!unlocked && (
                <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.95s both", marginTop: 40 }}>
                  <Glass style={{ maxWidth: 440, padding: "24px 28px" }}>
                    <div style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT, opacity: 0.6, marginBottom: 12 }}>
                      Preview mode
                    </div>
                    <p style={{ ...B, fontSize: 15, color: INK70, lineHeight: 1.7, marginBottom: 20 }}>
                      Your full roadmap is ready — {roadmap.phases.length} phases, {totalMilestones} milestones, scientific references, and side quests. Unlock everything for <strong style={{ color: INK }}>€5</strong>.
                    </p>
                    <div style={{ display: "flex", flexDirection: mob ? "column" : "row", gap: 10, alignItems: mob ? "stretch" : "center" }}>
                      <button onClick={handleUnlock}
                        style={{ ...M, fontSize: 12, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)", transition: "all 0.3s ease", textAlign: "center" }}>
                        Unlock full roadmap — €5
                      </button>
                      <span style={{ ...M, fontSize: 9, color: INK25 }}>One-time payment</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
                      {["Checkable milestones", "Scientific references", "Side quests", "Break it down", "Export roadmap"].map((f) => (
                        <span key={f} style={{ ...M, fontSize: 9, color: INK30, letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: 4 }}>{Icon.check(8, ACCENT)} {f}</span>
                      ))}
                    </div>
                  </Glass>
                </div>
              )}

              {unlocked && (
                <div style={{ marginTop: 72, display: "flex", alignItems: "center", gap: 10, animation: "fadeIn 1s ease 0.5s both" }}>
                  <div style={{ width: 1, height: 28, background: "linear-gradient(180deg, rgba(108,92,231,0.25), transparent)" }} />
                  <span style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: INK12 }}>Scroll to begin · {checkedCount}/{totalMilestones} milestones</span>
                </div>
              )}
            </section>

            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(26,26,46,0.04), transparent)" }} />

            {/* Phases */}
            {roadmap.phases.map((phase, i) => (
              <div key={i} ref={(el) => (phaseRefs.current[i] = el)}>
                {i > 0 && <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(26,26,46,0.03), transparent)" }} />}
                {unlocked ? (
                  <PhaseSection phase={phase} index={i} goal={roadmap.goal}
                    checkedMilestones={checkedMilestones} onToggleMilestone={toggleMilestone}
                    canBreakdown={canBreakdown} onUseCredit={useBreakdownCredit} onBuyBreakdown={handleBuyBreakdown} />
                ) : (
                  <LockedPhase phase={phase} index={i} />
                )}
              </div>
            ))}

            {/* Paywall reminder if locked */}
            {!unlocked && (
              <section style={{ minHeight: "40vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                <Reveal>
                  <div style={{ width: 48, height: 1, background: "rgba(108,92,231,0.12)", margin: "0 auto 32px" }} />
                </Reveal>
                <Reveal delay={0.12}>
                  <h2 style={{ fontFamily: H, fontSize: "clamp(24px, 3.5vw, 36px)", fontWeight: 400, color: "rgba(26,26,46,0.5)", marginBottom: 16 }}>
                    Your roadmap is waiting.
                  </h2>
                </Reveal>
                <Reveal delay={0.24}>
                  <button onClick={handleUnlock}
                    style={{ ...M, fontSize: 12, letterSpacing: "0.04em", padding: "14px 32px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)" }}>
                    Unlock for €5 →
                  </button>
                </Reveal>
              </section>
            )}

            {/* ━━━ CLOSING (unlocked) ━━━ */}
            {unlocked && (
              <section style={{ minHeight: "55vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", position: "relative" }}>
                <Reveal>
                  <div style={{ width: 48, height: 1, background: "rgba(108,92,231,0.12)", margin: "0 auto 32px" }} />
                </Reveal>

                {/* Progress summary */}
                <Reveal delay={0.08}>
                  <Glass style={{ padding: "18px 28px", marginBottom: 32, display: "inline-flex", alignItems: "center", gap: 16 }}>
                    <div style={{ display: "flex", gap: 3 }}>
                      {roadmap.phases.map((p, i) => p.milestones.map((_, j) => (
                        <div key={`${i}-${j}`} style={{
                          width: 8, height: 8, borderRadius: 2,
                          background: checkedMilestones[`${i}-${j}`] ? ACCENT : "rgba(26,26,46,0.06)",
                          transition: "all 0.3s ease",
                        }} />
                      )))}
                    </div>
                    <span style={{ ...M, fontSize: 10, color: INK25 }}>{checkedCount}/{totalMilestones} milestones</span>
                  </Glass>
                </Reveal>

                <Reveal delay={0.16}>
                  <h2 style={{ fontFamily: H, fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 400, letterSpacing: "-0.025em", color: "rgba(26,26,46,0.5)", marginBottom: 12 }}>
                    {allComplete ? "Every step, taken." : "Step by step. Starting now."}
                  </h2>
                </Reveal>
                <Reveal delay={0.24}>
                  <p style={{ fontFamily: H, fontSize: 16, fontStyle: "italic", color: "rgba(26,26,46,0.2)", marginBottom: 36, maxWidth: 380, lineHeight: 1.6 }}>
                    {allComplete
                      ? "Every milestone, every phase. This roadmap is complete. But the journey doesn't stop here."
                      : "Download your roadmap and check off milestones as you go. Every phase you complete gets you closer."}
                  </p>
                </Reveal>

                <Reveal delay={0.36}>
                  <div style={{ display: "flex", flexDirection: mob ? "column" : "row", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
                    <button onClick={handleShare}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: shareStatus === "copied" ? "rgba(85,239,196,0.12)" : "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: shareStatus === "copied" ? "1px solid rgba(85,239,196,0.3)" : "1px solid rgba(255,255,255,0.5)", color: shareStatus === "copied" ? "#00b894" : INK40, cursor: "pointer", transition: "all 0.3s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {shareStatus === "saving" ? "Saving..." : shareStatus === "copied" ? "Link copied!" : shareStatus === "error" ? "Failed — try again" : shareId ? "Copy link" : <>{Icon.share(14, INK40)} Save & share</>}
                    </button>
                    <button onClick={exportPDF}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)", color: INK40, cursor: "pointer", transition: "all 0.3s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {Icon.doc(14, INK40)} Export as PDF
                    </button>
                    {allComplete ? (
                      <button onClick={() => { handleReset(); }}
                        style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        Set your next goal {Icon.arrow(11, "#fff")}
                      </button>
                    ) : (
                      <>
                        <button onClick={handleReset}
                          style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)", color: INK40, cursor: "pointer", transition: "all 0.3s ease" }}>
                          New goal
                        </button>
                        <button onClick={startDayOne}
                          style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)" }}>
                          Take step one {Icon.arrow(11, "#fff")}
                        </button>
                      </>
                    )}
                  </div>
                </Reveal>

                {/* Wise closing quote */}
                <Reveal delay={0.5}>
                  {roadmap.closingQuote && (
                    <div style={{ marginTop: 56, maxWidth: 420, textAlign: "center" }}>
                      <div style={{ width: 24, height: 1, background: "rgba(108,92,231,0.15)", margin: "0 auto 24px" }} />
                      <p style={{ fontFamily: H, fontSize: 18, fontStyle: "italic", color: INK30, lineHeight: 1.7, marginBottom: 12 }}>
                        "{roadmap.closingQuote}"
                      </p>
                      <span style={{ ...M, fontSize: 9, letterSpacing: "0.1em", color: INK22, textTransform: "uppercase" }}>
                        — {roadmap.closingQuoteAuthor || "Unknown"}
                      </span>
                    </div>
                  )}
                </Reveal>

                <Reveal delay={0.65}>
                  <div style={{ marginTop: 48, ...M, fontSize: 9, color: INK25, letterSpacing: "0.14em" }}>PASO</div>
                </Reveal>
              </section>
            )}

            {/* ━━━ ALL-COMPLETE FINALE OVERLAY ━━━ */}
            {showFinale && (
              <div style={{
                position: "fixed", inset: 0, zIndex: 100, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: mob ? "flex-start" : "center", textAlign: "center",
                background: "linear-gradient(135deg, rgba(232,223,245,0.97), rgba(212,228,247,0.97))",
                animation: "fadeIn 1s ease both",
                overflowY: "auto", WebkitOverflowScrolling: "touch",
                paddingTop: mob ? 40 : 0, paddingBottom: mob ? 40 : 0,
              }}>
                <BubbleCelebration active={true} />
                <BubbleCelebration active={true} />

                <div style={{ position: "relative", zIndex: 2, padding: mob ? "0 24px" : "0 40px", maxWidth: 520 }}>
                  <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.3s both" }}>
                    <PasoOrb progress={100} interactive />
                  </div>

                  <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.6s both" }}>
                    <h1 style={{ fontFamily: H, fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 400, letterSpacing: "-0.04em", color: INK, marginTop: 40, marginBottom: 12, lineHeight: 1.1 }}>
                      Roadmap complete.
                    </h1>
                  </div>

                  <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.8s both" }}>
                    <p style={{ fontFamily: H, fontSize: 18, fontStyle: "italic", color: INK30, lineHeight: 1.7, marginBottom: 8 }}>
                      {totalMilestones} milestones. {roadmap.phases.length} phases. All done.
                    </p>
                    <p style={{ ...B, fontSize: 14, color: INK25, lineHeight: 1.7, marginBottom: 36 }}>
                      Every step taken. Now set a bigger goal.
                    </p>
                  </div>

                  {roadmap.closingQuote && (
                    <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 1s both", marginBottom: 40 }}>
                      <div style={{ width: 24, height: 1, background: "rgba(108,92,231,0.15)", margin: "0 auto 20px" }} />
                      <p style={{ fontFamily: H, fontSize: 17, fontStyle: "italic", color: INK30, lineHeight: 1.7, marginBottom: 8 }}>
                        "{roadmap.closingQuote}"
                      </p>
                      <span style={{ ...M, fontSize: 9, letterSpacing: "0.1em", color: INK22, textTransform: "uppercase" }}>
                        — {roadmap.closingQuoteAuthor}
                      </span>
                    </div>
                  )}

                  <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 1.2s both", display: "flex", flexDirection: mob ? "column" : "row", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={handleShare}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: shareStatus === "copied" ? "rgba(85,239,196,0.12)" : "rgba(255,255,255,0.5)", backdropFilter: "blur(16px)", border: shareStatus === "copied" ? "1px solid rgba(85,239,196,0.3)" : "1px solid rgba(255,255,255,0.6)", color: shareStatus === "copied" ? "#00b894" : INK40, cursor: "pointer", width: mob ? "100%" : "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {shareStatus === "copied" ? "Link copied!" : shareId ? "Copy link" : <>{Icon.share(14, INK40)} Share</>}
                    </button>
                    <button onClick={exportPDF}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.5)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.6)", color: INK40, cursor: "pointer", width: mob ? "100%" : "auto" }}>
                      {Icon.doc(14, INK40)} Save as PDF
                    </button>
                    <button onClick={() => { setShowFinale(false); handleReset(); }}
                      style={{ ...M, fontSize: 12, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)", width: mob ? "100%" : "auto" }}>
                      Set your next goal {Icon.arrow(11, "#fff")}
                    </button>
                  </div>

                  <div style={{ animation: "fadeIn 1s ease 1.8s both", marginTop: 48 }}>
                    <span style={{ ...M, fontSize: 9, color: INK25, letterSpacing: "0.14em" }}>PASO</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ━━━ EXAMPLE PREVIEW OVERLAY ━━━ */}
      {previewExample && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(26,26,46,0.4)", backdropFilter: "blur(16px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: mob ? 16 : 40,
          animation: previewClosing ? "fadeOut 0.3s ease both" : "fadeIn 0.3s ease both",
        }} onClick={closePreview}>
          <div style={{
            background: "rgba(255,255,255,0.85)", backdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.6)",
            borderRadius: 24, padding: mob ? 24 : 40,
            maxWidth: 600, width: "100%",
            maxHeight: "85vh", overflowY: "auto",
            boxShadow: "0 24px 80px rgba(0,0,0,0.12)",
            animation: previewClosing ? "slideDown 0.3s ease both" : "slideUp 0.5s cubic-bezier(0.16,1,0.3,1) both",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: previewExample.color }} />
                <span style={{ ...M, fontSize: 9, color: INK25, letterSpacing: "0.08em" }}>{previewExample.timeline}</span>
              </div>
              <button onClick={closePreview} style={{ ...M, fontSize: 10, color: INK25, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                {Icon.close(10, INK25)} Close
              </button>
            </div>

            {/* Goal */}
            <h2 style={{ fontFamily: H, fontSize: mob ? 24 : 30, fontWeight: 400, color: INK, lineHeight: 1.15, marginBottom: 6 }}>{previewExample.goal}</h2>
            <p style={{ ...B, fontSize: 13, fontStyle: "italic", color: INK30, marginBottom: 28 }}>{previewExample.tagline}</p>

            {/* Phase tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 32, flexWrap: "wrap" }}>
              {previewExample.phases.map((p, i) => (
                <div key={i} style={{
                  ...M, fontSize: 9, letterSpacing: "0.04em", padding: "5px 12px", borderRadius: 8,
                  background: i === 0 ? ACCENT : "rgba(26,26,46,0.04)",
                  color: i === 0 ? "#fff" : INK25,
                }}>
                  {String(i + 1).padStart(2, "0")} {p}
                </div>
              ))}
            </div>

            {/* Phase 1 detail */}
            <div style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT, opacity: 0.6, marginBottom: 10 }}>Phase 1</div>
            <h3 style={{ fontFamily: H, fontSize: mob ? 20 : 24, fontWeight: 400, color: INK, marginBottom: 12 }}>{previewExample.phase1.title}</h3>
            <p style={{ ...B, fontSize: 14, color: INK45, lineHeight: 1.7, marginBottom: 28 }}>{previewExample.phase1.description}</p>

            {/* Milestones */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
              {previewExample.phase1.milestones.map((m, i) => {
                const checked = previewChecked[i] || false;
                return (
                  <div key={i} onClick={() => { setPreviewChecked((p) => ({ ...p, [i]: !p[i] })); if (!checked && soundEnabled) playMilestoneTick(); }}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", transition: "opacity 0.3s" }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 6, flexShrink: 0, marginTop: 1,
                      border: checked ? "none" : "1.5px solid rgba(108,92,231,0.25)",
                      background: checked ? ACCENT : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.3s ease",
                    }}>
                      {checked && <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <span style={{ ...B, fontSize: 13, color: checked ? INK25 : INK50, lineHeight: 1.6, textDecoration: checked ? "line-through" : "none", transition: "all 0.3s" }}>{m}</span>
                  </div>
                );
              })}
            </div>

            {/* Research insight */}
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(108,92,231,0.04)", border: "1px solid rgba(108,92,231,0.1)", marginBottom: 16 }}>
              <div style={{ ...M, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT, opacity: 0.6, marginBottom: 6 }}>Research insight</div>
              <p style={{ ...B, fontSize: 12, color: INK45, lineHeight: 1.7 }}>{previewExample.phase1.insight}</p>
            </div>

            {/* Side quest */}
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(85,239,196,0.06)", border: "1px solid rgba(85,239,196,0.15)", marginBottom: 16 }}>
              <div style={{ ...M, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: "#00b894", opacity: 0.7, marginBottom: 6 }}>Side quest</div>
              <p style={{ ...B, fontSize: 12, color: INK45, lineHeight: 1.7 }}>{previewExample.phase1.sideQuest}</p>
            </div>

            {/* Reality check */}
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(253,121,168,0.05)", border: "1px solid rgba(253,121,168,0.12)", marginBottom: 32 }}>
              <div style={{ ...M, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: "#e17055", opacity: 0.7, marginBottom: 6 }}>Reality check</div>
              <p style={{ ...B, fontSize: 12, color: INK45, lineHeight: 1.7 }}>{previewExample.phase1.realityCheck}</p>
            </div>

            {/* Locked phases teaser */}
            <div style={{ textAlign: "center", padding: "20px 0 8px", borderTop: "1px solid rgba(26,26,46,0.05)" }}>
              <p style={{ ...B, fontSize: 13, color: INK25, marginBottom: 4 }}>Phases 2–4 are generated when you personalize</p>
              <p style={{ ...B, fontSize: 11, color: INK22 }}>Your answers shape the entire roadmap — no two are alike</p>
            </div>

            {/* CTA */}
            <button onClick={() => { setInputValue(previewExample.goal.toLowerCase()); setPreviewClosing(true); setTimeout(() => { setPreviewExample(null); setPreviewClosing(false); setPreviewChecked({}); }, 300); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              style={{
                ...M, fontSize: 12, letterSpacing: "0.04em", fontWeight: 500,
                width: "100%", padding: "16px 0", marginTop: 20,
                borderRadius: 14, border: "none", cursor: "pointer",
                background: ACCENT, color: "#fff",
                transition: "all 0.3s ease",
                boxShadow: "0 4px 20px rgba(108,92,231,0.3)",
              }}
              onMouseEnter={(e) => e.target.style.transform = "translateY(-2px)"}
              onMouseLeave={(e) => e.target.style.transform = "translateY(0)"}>
              Personalize this roadmap →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
