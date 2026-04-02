"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import * as Tone from "tone";

/* ─── API CLIENT (all secrets are server-side in /api routes) ─── */

// Security: every API call includes this header.
// The server rejects requests without it — blocks curl/terminal abuse.
const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Paso-Client": "paso-web-2026",
};

function generateId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function sanitize(str, maxLen = 2000) {
  if (typeof str !== "string") return "";
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x20-\x7E\u00C0-\u024F\u0370-\u03FF\u2000-\u206F\u2190-\u21FF\n\r\t ]/g, "")
    .trim()
    .slice(0, maxLen);
}

async function saveRoadmap(roadmapData, answersData, goalText, retries = 2) {
  const id = generateId();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/api/roadmaps", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({ id, goal: sanitize(goalText, 500), roadmap: roadmapData, answers: answersData, progress: {} }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      return id;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function loadRoadmap(id) {
  const res = await fetch(`/api/roadmaps?id=${id}`, { headers: API_HEADERS });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load");
  }
  return res.json();
}

async function updateProgress(id, progress) {
  try {
    await fetch("/api/roadmaps", {
      method: "PATCH",
      headers: API_HEADERS,
      body: JSON.stringify({ id, progress }),
    });
  } catch (e) { /* silent fail for progress saves */ }
}

async function patchRoadmap(id, updates) {
  const res = await fetch("/api/roadmaps", {
    method: "PATCH",
    headers: API_HEADERS,
    body: JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Update failed");
  }
}

async function fetchRoadmapCount() {
  try {
    const res = await fetch("/api/roadmaps/count", { headers: API_HEADERS });
    const data = await res.json();
    return data.count || 0;
  } catch { return 0; }
}

/* ─── CALENDAR (.ics) GENERATION ─── */
function formatICSDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function generateICS(title, description, startDate, durationMinutes = 60) {
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const alarm = durationMinutes >= 60 ? 15 : 5; // reminder before event
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Paso//Roadmap//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${title.replace(/[,;\\]/g, " ")}`,
    `DESCRIPTION:${(description || "").replace(/[,;\\]/g, " ").replace(/\n/g, "\\n")}`,
    "STATUS:CONFIRMED",
    `UID:paso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@paso.app`,
    "BEGIN:VALARM",
    "TRIGGER:-PT" + alarm + "M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${title.replace(/[,;\\]/g, " ")}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
function generateBulkICS(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Paso//Roadmap//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  events.forEach((ev) => {
    const start = new Date(ev.start);
    const end = new Date(start.getTime() + (ev.duration || 60) * 60000);
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART:${formatICSDate(start)}`,
      `DTEND:${formatICSDate(end)}`,
      `SUMMARY:${ev.title.replace(/[,;\\]/g, " ")}`,
      `DESCRIPTION:${(ev.description || "").replace(/[,;\\]/g, " ").replace(/\n/g, "\\n")}`,
      "STATUS:CONFIRMED",
      `UID:paso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@paso.app`,
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${ev.title.replace(/[,;\\]/g, " ")}`,
      "END:VALARM",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function downloadICS(icsContent, filename = "paso-milestone.ics") {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
function parseTimelineWeeks(timeline) {
  if (!timeline) return 12;
  const m = timeline.match(/(\d+)\s*week/i);
  if (m) return parseInt(m[1]);
  const mo = timeline.match(/(\d+)\s*month/i);
  if (mo) return parseInt(mo[1]) * 4;
  return 12;
}

/* ─── SOUND SYSTEM — Minecraft-style ambient ─── */
let audioReady = false;
const synths = {};
let ambientInterval = null;
let ambientRunning = false;
let ambientTick = 0;
let ambientPhase = 0; // 0=awakening, 1=growing, 2=flowing
let ambientElapsed = 0;
let ambientPhaseTimer = null;

async function initAudio() {
  if (audioReady && Tone.context.state === "running") return;
  audioReady = false; // Reset — iOS may have blocked previous attempt
  try {
    await Tone.start();
    if (Tone.context.state !== "running") await Tone.context.resume();
    // Verify it actually started — iOS may silently fail
    if (Tone.context.state !== "running") {
      console.warn("Audio: context still not running after resume, state:", Tone.context.state);
      return;
    }
    audioReady = true;

    // ─── INSTRUMENTS ───
    // Piano (all phases)
    const pianoRev = new Tone.Reverb({ decay: 7, wet: 0.55 }).toDestination();
    const pianoGain = new Tone.Gain(0.08).connect(pianoRev);
    synths.piano = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.04, decay: 3.5, sustain: 0.02, release: 4.5 },
    }).connect(pianoGain);
    synths.pianoGain = pianoGain;

    // Kalimba (phase 2+)
    const kalRev = new Tone.Reverb({ decay: 5, wet: 0.5 }).toDestination();
    const kalGain = new Tone.Gain(0).connect(kalRev);
    synths.kalimba = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 2, sustain: 0, release: 3 },
    }).connect(kalGain);
    synths.kalimbaGain = kalGain;

    // Glass bell (phase 3)
    const bellRev = new Tone.Reverb({ decay: 6, wet: 0.55 }).toDestination();
    const bellGain = new Tone.Gain(0).connect(bellRev);
    synths.bell = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 2.8, sustain: 0, release: 3.5 },
    }).connect(bellGain);
    synths.bellGain = bellGain;

    // Pad chord (phase 2+)
    const padRev = new Tone.Reverb({ decay: 9, wet: 0.5 }).toDestination();
    const padGain = new Tone.Gain(0).connect(padRev);
    synths.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 5, decay: 4, sustain: 0.25, release: 6 },
    }).connect(padGain);
    synths.padGain = padGain;

    // Interaction reverb (shared)
    synths.fxRev = new Tone.Reverb({ decay: 6, wet: 0.5 }).toDestination();

    // Hover whisper
    const hoverRev = new Tone.Reverb({ decay: 3, wet: 0.6 }).toDestination();
    synths.hover = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.15, decay: 0.6, sustain: 0, release: 1.5 },
      volume: -32,
    }).connect(hoverRev);

  } catch (e) { console.warn("Audio init failed:", e); }
}

// ─── PROGRESSIVE AMBIENT PHRASES ───
// Phase 1: very sparse piano
const PH1_PIANO = ["C4",null,null,null,"E4",null,null,null,null,null,"G4",null,null,null,null,null,null,null,
                   "A4",null,null,null,null,"G4",null,null,null,null,null,"E4",null,null,null,null,null,null];
// Phase 2: piano + kalimba
const PH2_PIANO =   ["C4",null,null,null,"E4",null,null,null,"G4",null,null,null,null,null,
                     "A4",null,null,null,"G4",null,null,"E4",null,null,null,null,null,null];
const PH2_KALIMBA = [null,null,"C5","E5","G5",null,null,null,null,null,null,null,null,null,
                     null,null,null,null,null,"A4","C5","E5","C5",null,null,null,null,null];
// Phase 3: all three
const PH3_PIANO =   ["C4",null,null,"E4",null,null,"G4",null,null,null,null,null,
                     "A4",null,null,"G4",null,"E4",null,null,null,null,null,null];
const PH3_KALIMBA = [null,"C5","E5",null,"G5","E5",null,null,null,null,null,null,
                     null,"A4","C5",null,"E5","G5","E5",null,null,null,null,null];
const PH3_BELL =    [null,null,null,null,null,null,"E6",null,null,null,null,null,
                     null,null,null,null,null,null,null,"G5",null,null,null,null];
const PAD_CHORDS = [["C3","G3","E4"], ["A2","E3","C4"], ["F3","A3","C4","E4"], ["G3","B3","D4","F4"]];

function fadeGain(g, target, sec) {
  const steps = 40, curr = g.gain.value, diff = target - curr;
  let s = 0;
  const iv = setInterval(() => { s++; g.gain.value = curr + diff * (s / steps); if (s >= steps) clearInterval(iv); }, (sec * 1000) / steps);
}

function playAmbientTick() {
  if (!audioReady || !ambientRunning) return;
  if (ambientPhase === 0) {
    const n = PH1_PIANO[ambientTick % PH1_PIANO.length];
    if (n) synths.piano?.triggerAttackRelease(n, "2n");
  } else if (ambientPhase === 1) {
    const pn = PH2_PIANO[ambientTick % PH2_PIANO.length];
    const kn = PH2_KALIMBA[ambientTick % PH2_KALIMBA.length];
    if (pn) synths.piano?.triggerAttackRelease(pn, "2n");
    if (kn) synths.kalimba?.triggerAttackRelease(kn, "8n");
  } else {
    const pn = PH3_PIANO[ambientTick % PH3_PIANO.length];
    const kn = PH3_KALIMBA[ambientTick % PH3_KALIMBA.length];
    const bn = PH3_BELL[ambientTick % PH3_BELL.length];
    if (pn) synths.piano?.triggerAttackRelease(pn, "2n");
    if (kn) synths.kalimba?.triggerAttackRelease(kn, "8n");
    if (bn) synths.bell?.triggerAttackRelease(bn, "8n");
  }
  ambientTick++;
}

function startAmbient() {
  if (!audioReady || ambientRunning) return;
  ambientRunning = true;
  ambientTick = 0;
  ambientElapsed = 0;
  ambientPhase = 0;
  ambientInterval = setInterval(playAmbientTick, 600);
  // Phase progression
  ambientPhaseTimer = setInterval(() => {
    ambientElapsed++;
    if (ambientElapsed === 40 && ambientPhase === 0) {
      ambientPhase = 1;
      fadeGain(synths.kalimbaGain, 0.09, 5);
      fadeGain(synths.padGain, 0.016, 6);
      synths.pad?.triggerAttackRelease(PAD_CHORDS[0], 18);
    }
    if (ambientElapsed === 80 && ambientPhase === 1) {
      ambientPhase = 2;
      fadeGain(synths.bellGain, 0.055, 5);
      fadeGain(synths.kalimbaGain, 0.11, 4);
      fadeGain(synths.padGain, 0.022, 5);
    }
    if (ambientElapsed % 20 === 0 && ambientPhase >= 1) {
      synths.pad?.triggerAttackRelease(PAD_CHORDS[Math.floor(ambientElapsed / 20) % PAD_CHORDS.length], 18);
    }
    if (ambientElapsed >= 120) ambientElapsed = 40;
  }, 1000);
}

function stopAmbient() {
  ambientRunning = false;
  ambientTick = 0;
  ambientElapsed = 0;
  ambientPhase = 0;
  if (ambientInterval) { clearInterval(ambientInterval); ambientInterval = null; }
  if (ambientPhaseTimer) { clearInterval(ambientPhaseTimer); ambientPhaseTimer = null; }
  try {
    if (synths.kalimbaGain) synths.kalimbaGain.gain.value = 0;
    if (synths.bellGain) synths.bellGain.gain.value = 0;
    if (synths.padGain) synths.padGain.gain.value = 0;
  } catch (e) {}
}

// ─── INTERACTION SOUNDS (warm layered piano + kalimba) ───
function playHoverWhisper() {
  if (!audioReady) return;
  const notes = ["G5", "A5", "C6", "D6", "E6"];
  synths.hover?.triggerAttackRelease(notes[Math.floor(Math.random() * notes.length)], "16n");
}

function playRevealChime() {
  if (!audioReady) return;
  const pSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.015, decay: 1.5, sustain: 0.02, release: 2.5 } }).connect(new Tone.Gain(0.1).connect(synths.fxRev));
  const kSyn = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.003, decay: 1.2, sustain: 0, release: 2 } }).connect(new Tone.Gain(0.06).connect(synths.fxRev));
  pSyn.triggerAttackRelease("E5", "8n");
  setTimeout(() => { pSyn.triggerAttackRelease("G5", "8n"); kSyn.triggerAttackRelease("E5", "16n"); }, 100);
}

function playUnlockSound() {
  if (!audioReady) return;
  const pSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.015, decay: 2.5, sustain: 0.02, release: 3.5 } }).connect(new Tone.Gain(0.1).connect(synths.fxRev));
  const kSyn = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.003, decay: 2, sustain: 0, release: 2.5 } }).connect(new Tone.Gain(0.06).connect(synths.fxRev));
  const mel = ["C4", "E4", "G4", "C5", "E5", "G5", "C6"];
  mel.forEach((n, i) => {
    setTimeout(() => pSyn.triggerAttackRelease(n, "4n"), i * 130);
    if (i > 0) setTimeout(() => kSyn.triggerAttackRelease(n, "8n"), i * 130 + 50);
  });
}

let milestoneTickCount = 0;
const TICK_SCALE = ["C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6", "D6", "E6", "F6", "G6"];
function playMilestoneTick() {
  if (!audioReady) return;
  const note = TICK_SCALE[milestoneTickCount % TICK_SCALE.length];
  const pSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.012, decay: 1.2, sustain: 0.01, release: 2 } }).connect(new Tone.Gain(0.1).connect(synths.fxRev));
  const kSyn = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.003, decay: 1, sustain: 0, release: 1.5 } }).connect(new Tone.Gain(0.06).connect(synths.fxRev));
  pSyn.triggerAttackRelease(note, "8n");
  setTimeout(() => kSyn.triggerAttackRelease(note, "16n"), 30);
  milestoneTickCount++;
}

function playBreakdownDone() {
  if (!audioReady) return;
  const pSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.015, decay: 1.5, sustain: 0.02, release: 2 } }).connect(new Tone.Gain(0.1).connect(synths.fxRev));
  pSyn.triggerAttackRelease("D5", "8n");
  setTimeout(() => pSyn.triggerAttackRelease("G5", "8n"), 100);
}

// Phase complete — bright, bouncy, happy ascending run
function playCelebration() {
  if (!audioReady) return;
  const pSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 1.5, sustain: 0.02, release: 2.5 } }).connect(new Tone.Gain(0.11).connect(synths.fxRev));
  const kSyn = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.003, decay: 1.2, sustain: 0, release: 2 } }).connect(new Tone.Gain(0.08).connect(synths.fxRev));
  // Happy bouncy run — quick ascending, kalimba sparkles between
  const run = ["C5", "E5", "G5", "A5", "C6", "E6", "G6"];
  run.forEach((n, i) => {
    setTimeout(() => pSyn.triggerAttackRelease(n, "8n"), i * 80);
    if (i % 2 === 0) setTimeout(() => kSyn.triggerAttackRelease(n, "16n"), i * 80 + 40);
  });
  // Bright double tap at the top
  setTimeout(() => kSyn.triggerAttackRelease("G6", "8n"), run.length * 80 + 60);
  setTimeout(() => kSyn.triggerAttackRelease("C7", "4n"), run.length * 80 + 160);
}

// Stone press sound (used in intro)
function playStonePress() {
  if (!audioReady) return;
  const pSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.02, decay: 2.5, sustain: 0.02, release: 3.5 } }).connect(new Tone.Gain(0.1).connect(synths.fxRev));
  const kSyn = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.003, decay: 2, sustain: 0, release: 2.5 } }).connect(new Tone.Gain(0.06).connect(synths.fxRev));
  const deepSyn = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 2, sustain: 0.02, release: 3 } }).connect(new Tone.Gain(0.08).connect(synths.fxRev));
  deepSyn.triggerAttackRelease("C3", "2n");
  setTimeout(() => pSyn.triggerAttackRelease("G3", "2n"), 80);
  setTimeout(() => pSyn.triggerAttackRelease("C4", "4n"), 200);
  setTimeout(() => pSyn.triggerAttackRelease("E4", "4n"), 340);
  setTimeout(() => kSyn.triggerAttackRelease("G4", "8n"), 480);
  setTimeout(() => kSyn.triggerAttackRelease("C5", "8n"), 600);
  setTimeout(() => kSyn.triggerAttackRelease("E5", "8n"), 720);
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
  bookmark: (sz = 12, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v12L8 11l-5 3.5V2.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>
  ),
  whatsapp: (sz = 16, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
  ),
  message: (sz = 14, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 3V3z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>
  ),
  adjust: (sz = 14, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M2 4h3m3 0h6M2 8h6m3 0h3M2 12h1m3 0h8" stroke={c} strokeWidth="1.3" strokeLinecap="round"/><circle cx="7.5" cy="4" r="1.5" stroke={c} strokeWidth="1.2"/><circle cx="10.5" cy="8" r="1.5" stroke={c} strokeWidth="1.2"/><circle cx="5" cy="12" r="1.5" stroke={c} strokeWidth="1.2"/></svg>
  ),
  bell: (sz = 14, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M4 6a4 4 0 018 0c0 2.5 1 4 2 5H2c1-1 2-2.5 2-5z" stroke={c} strokeWidth="1.2" strokeLinejoin="round"/><path d="M6 11v.5a2 2 0 004 0V11" stroke={c} strokeWidth="1.2" strokeLinecap="round"/></svg>
  ),
  clipboard: (sz = 14, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="11" rx="1.5" stroke={c} strokeWidth="1.2"/><path d="M6 1.5h4a.5.5 0 01.5.5v1a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" stroke={c} strokeWidth="1.1"/></svg>
  ),
  calendar: (sz = 14, c = "currentColor") => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke={c} strokeWidth="1.2"/><path d="M2 6.5h12" stroke={c} strokeWidth="1.1"/><path d="M5.5 1.5v3M10.5 1.5v3" stroke={c} strokeWidth="1.2" strokeLinecap="round"/></svg>
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

/* ─── API — prompts are server-side in /api/generate ─── */
async function callAPI(action, data, _retry = true) {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({ action, ...data }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || `API error: ${res.status}`);
    }
    const resp = await res.json();
    const text = resp.content.map((c) => c.text || "").join("");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("No valid JSON in response");
    }
    return JSON.parse(text.substring(firstBrace, lastBrace + 1));
  } catch (e) {
    if (_retry) {
      console.warn("Retrying API call:", e.message);
      return callAPI(action, data, false);
    }
    console.error("API failed after retry:", e.message);
    throw new Error("Something went wrong. Please try again.");
  }
}

async function generateQuestions(goal) {
  return callAPI("questions", { goal: sanitize(goal, 500) });
}

async function generateRoadmap(goal, answers, extras) {
  return callAPI("roadmap", {
    goal: sanitize(goal, 500),
    answers: answers.map((a) => ({
      id: a.id,
      question: a.question,
      answer: a.answer,
    })),
    extras,
  });
}

async function breakdownPhase(goal, phase, mode) {
  return callAPI("breakdown", {
    goal: sanitize(goal, 500),
    phase: {
      title: phase.title,
      weeks: phase.weeks,
      description: phase.description,
      milestones: phase.milestones,
      actions: phase.actions,
    },
    mode,
  });
}

async function adjustRoadmap(goal, roadmap, adjustInput, completedMilestones) {
  return callAPI("adjust", {
    goal: sanitize(goal, 500),
    roadmap,
    adjustInput: sanitize(adjustInput, 1000),
    completedMilestones,
  });
}

/* ─── CHECKABLE MILESTONE ─── */
function Milestone({ text, checked, onToggle, onSchedule, scheduled }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
      <div onClick={onToggle} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", userSelect: "none", flex: 1 }}>
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
      {onSchedule && !checked && (
        <button onClick={(e) => { e.stopPropagation(); onSchedule(); }} style={{
          background: scheduled ? "rgba(108,92,231,0.08)" : "transparent",
          border: "none", cursor: "pointer", padding: 4, borderRadius: 6, flexShrink: 0, marginTop: 0,
          transition: "all 0.2s",
        }} title={scheduled ? "Scheduled!" : "Add to calendar"}>
          {scheduled ? Icon.check(12, "#00b894") : Icon.calendar(14, INK22)}
        </button>
      )}
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

  // Calendar scheduling state
  const [schedulingIdx, setSchedulingIdx] = useState(null); // which milestone is being scheduled
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduledSet, setScheduledSet] = useState({}); // { milestoneIdx: true }

  const handleScheduleMilestone = (milestoneIdx) => {
    if (schedulingIdx === milestoneIdx) { setSchedulingIdx(null); return; }
    // Default to tomorrow 9am
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setScheduleDate(local);
    setSchedulingIdx(milestoneIdx);
  };

  const confirmSchedule = (milestoneIdx) => {
    if (!scheduleDate) return;
    const milestone = phase.milestones[milestoneIdx];
    const ics = generateICS(
      milestone,
      `Paso roadmap · ${phase.title}\nGoal: ${goal}`,
      scheduleDate,
      60
    );
    downloadICS(ics, `paso-${phase.title.replace(/\s+/g, "-").toLowerCase()}-${milestoneIdx + 1}.ics`);
    setScheduledSet((prev) => ({ ...prev, [milestoneIdx]: true }));
    setSchedulingIdx(null);
    playRevealChime();
  };

  const scheduleAllRemaining = () => {
    const unchecked = phase.milestones
      .map((m, i) => ({ text: m, idx: i }))
      .filter((m) => !checkedMilestones[`${index}-${m.idx}`]);
    if (unchecked.length === 0) return;
    // Space milestones evenly: start tomorrow, one every 3 days
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    const events = unchecked.map((m, i) => {
      const d = new Date(start.getTime() + i * 3 * 24 * 60 * 60 * 1000);
      return {
        title: m.text,
        description: `Paso · ${phase.title}\nGoal: ${goal}`,
        start: d.toISOString(),
        duration: 60,
      };
    });
    const ics = generateBulkICS(events);
    downloadICS(ics, `paso-${phase.title.replace(/\s+/g, "-").toLowerCase()}-all.ics`);
    const newScheduled = {};
    unchecked.forEach((m) => { newScheduled[m.idx] = true; });
    setScheduledSet((prev) => ({ ...prev, ...newScheduled }));
    playRevealChime();
  };

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
                  <div key={i}>
                    <Milestone text={m}
                      checked={checkedMilestones[`${index}-${i}`] || false}
                      onToggle={() => onToggleMilestone(`${index}-${i}`)}
                      onSchedule={() => handleScheduleMilestone(i)}
                      scheduled={!!scheduledSet[i]}
                    />
                    {schedulingIdx === i && (
                      <div style={{
                        marginLeft: 26, marginBottom: 14, padding: "10px 12px",
                        background: "rgba(108,92,231,0.04)", borderRadius: 10,
                        border: "1px solid rgba(108,92,231,0.1)",
                      }}>
                        <div style={{ ...M, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: INK25, marginBottom: 8 }}>
                          Schedule this milestone
                        </div>
                        <input
                          type="datetime-local"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          style={{
                            ...B, fontSize: 13, width: "100%", padding: "8px 10px",
                            borderRadius: 8, border: "1px solid rgba(108,92,231,0.15)",
                            background: "rgba(255,255,255,0.7)", color: INK,
                            marginBottom: 8, outline: "none",
                          }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => confirmSchedule(i)} style={{
                            ...M, fontSize: 11, flex: 1, padding: "8px 12px",
                            borderRadius: 8, border: "none", cursor: "pointer",
                            background: ACCENT, color: "#fff",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          }}>{Icon.calendar(12, "#fff")} Add to calendar</button>
                          <button onClick={() => setSchedulingIdx(null)} style={{
                            ...M, fontSize: 11, padding: "8px 12px",
                            borderRadius: 8, border: "1px solid rgba(26,26,46,0.08)",
                            background: "transparent", color: INK30, cursor: "pointer",
                          }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {/* Schedule all remaining */}
                {phase.milestones.some((_, i) => !checkedMilestones[`${index}-${i}`]) && (
                  <button onClick={scheduleAllRemaining} style={{
                    ...M, fontSize: 10, width: "100%", padding: "8px 12px", marginTop: 4,
                    borderRadius: 8, cursor: "pointer",
                    border: "1px dashed rgba(108,92,231,0.2)", background: "transparent", color: ACCENT,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    opacity: 0.7, transition: "opacity 0.2s",
                  }}>{Icon.calendar(12, ACCENT)} Schedule all to calendar</button>
                )}
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
                  <button onClick={() => { onBuyBreakdown("unlimited"); }}
                    style={{ ...M, fontSize: 10, padding: "8px 16px", borderRadius: 10, border: "none", background: ACCENT, color: "#fff", cursor: "pointer", transition: "all 0.3s ease" }}>
                    Break it down (included)
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
  const [extraFocused, setExtraFocused] = useState(false);

  const extraField = showExtra ? (
    <div style={{ marginTop: 10, animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both" }}>
      <textarea value={extraText} placeholder="The more we know, the better your roadmap..."
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => { setExtraText(e.target.value); if (onExtra) onExtra(q.id, e.target.value); }}
        onFocus={(e) => { setExtraFocused(true); }}
        onBlur={(e) => { setExtraFocused(false); }}
        rows={2}
        style={{
          width: "100%", background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)",
          border: extraFocused ? `2px solid ${ACCENT}` : extraText.trim() ? `1.5px solid ${ACCENT}40` : "1.5px solid rgba(108,92,231,0.2)",
          borderRadius: 12, padding: "10px 14px",
          fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: INK, lineHeight: 1.5,
          resize: "none", outline: "none", transition: "all 0.4s ease",
          boxShadow: extraFocused ? "0 4px 20px rgba(108,92,231,0.18)" : "none",
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
// ─── INTRO STONE CANVAS ───
function IntroStone({ mob, onPress }) {
  const canvasRef = useRef(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const stateRef = useRef({ pressed: false, fadeOut: false, floatT: 0, stoneY: 0, stoneScl: 1, glowStr: 0.35, fadeAlpha: 1, mouseX: -999, mouseY: -999, tiles: [] });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const st = stateRef.current;
    let W, H, cx, cy, S, BR, GAP, ELEV, animId;

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      cx = W / 2; cy = H / 2 - 20;
      S = mob ? 30 : 38;
      BR = mob ? 7 : 9;
      GAP = mob ? 3.5 : 4.5;
      ELEV = mob ? 5 : 7;
      // Build grid
      const hStep = S * 1.5 + GAP;
      const vStep = S * Math.sqrt(3) + GAP;
      const cols = Math.ceil(W / hStep) + 4;
      const rows = Math.ceil(H / vStep) + 4;
      st.tiles = [];
      for (let row = -Math.floor(rows/2); row <= Math.floor(rows/2); row++) {
        for (let col = -Math.floor(cols/2); col <= Math.floor(cols/2); col++) {
          const x = cx + col * hStep + (Math.abs(row) % 2 === 1 ? hStep / 2 : 0);
          const y = cy + row * vStep;
          const dist = Math.sqrt((x-cx)**2 + (y-cy)**2);
          if (dist < S * 1.8) continue;
          st.tiles.push({ x, y, dist });
        }
      }
    }
    resize();
    window.addEventListener("resize", resize);

    function hexPath(x, y, r, br, offy) {
      const pts = [0,60,120,180,240,300].map(a => {
        const rad = (a - 90) * Math.PI / 180;
        return { x: x + r * Math.cos(rad), y: y + r * Math.sin(rad) + (offy||0) };
      });
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const c = pts[i], p = pts[(i+5)%6], n = pts[(i+1)%6];
        const pL = Math.sqrt((p.x-c.x)**2+(p.y-c.y)**2);
        const nL = Math.sqrt((n.x-c.x)**2+(n.y-c.y)**2);
        const p1 = { x: c.x+(p.x-c.x)/pL*br, y: c.y+(p.y-c.y)/pL*br };
        const p2 = { x: c.x+(n.x-c.x)/nL*br, y: c.y+(n.y-c.y)/nL*br };
        if (i===0) ctx.moveTo(p1.x, p1.y); else ctx.lineTo(p1.x, p1.y);
        ctx.quadraticCurveTo(c.x, c.y, p2.x, p2.y);
      }
      ctx.closePath();
    }

    function draw() {
      const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
      bg.addColorStop(0, "#f8f5ff"); bg.addColorStop(0.5, "#eef6f3"); bg.addColorStop(1, "#f2f0ff");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = st.fadeAlpha;
      const maxDist = Math.max(W, H) * 0.48;
      const stoneCY = cy + st.stoneY + Math.sin(st.floatT) * (mob ? 3.5 : 5);

      // White tiles
      st.tiles.forEach(t => {
        const fade = Math.max(0, 1 - t.dist / maxDist);
        if (fade < 0.03) return;
        const mDist = Math.sqrt((t.x - st.mouseX)**2 + (t.y - st.mouseY)**2);
        const hLift = Math.max(0, 1 - mDist / (mob ? 80 : 120)) * (mob ? 1.5 : 2.5);
        const hBright = Math.max(0, 1 - mDist / (mob ? 100 : 140)) * 0.06;

        // Shadow (hex shaped)
        ctx.globalAlpha = fade * 0.18 * st.fadeAlpha;
        hexPath(t.x, t.y, S, BR, ELEV - hLift); ctx.fillStyle = "#ccc8d8"; ctx.fill();
        // Face
        ctx.globalAlpha = fade * 0.5 * st.fadeAlpha;
        hexPath(t.x, t.y, S, BR, -hLift);
        ctx.fillStyle = `rgb(${248+hBright*80},${248+hBright*60},${252+hBright*30})`; ctx.fill();
        // Highlight
        ctx.globalAlpha = fade * 0.15 * st.fadeAlpha;
        hexPath(t.x, t.y-1, S*0.85, BR*0.8, -hLift); ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
      });

      ctx.globalAlpha = st.fadeAlpha;

      // Glow under stone
      const glGrad = ctx.createRadialGradient(cx, stoneCY+ELEV+12, 0, cx, stoneCY+ELEV+12, S*2.5);
      glGrad.addColorStop(0, "rgba(147,130,255,"+(st.glowStr)+")");
      glGrad.addColorStop(0.35, "rgba(134,200,255,"+(st.glowStr*0.5)+")");
      glGrad.addColorStop(0.6, "rgba(134,239,172,"+(st.glowStr*0.2)+")");
      glGrad.addColorStop(1, "transparent");
      ctx.fillStyle = glGrad; ctx.beginPath();
      ctx.ellipse(cx, stoneCY+ELEV+12, S*2.5, S*0.8, 0, 0, Math.PI*2); ctx.fill();

      // Stone
      ctx.save();
      ctx.translate(cx, stoneCY); ctx.scale(st.stoneScl, st.stoneScl); ctx.translate(-cx, -stoneCY);

      // Shadow (hex shaped, offset down, soft)
      ctx.globalAlpha = 0.22 * st.fadeAlpha;
      hexPath(cx, stoneCY, S*0.97, BR, ELEV+5); ctx.fillStyle = "rgba(60,50,110,0.45)"; ctx.fill();
      ctx.globalAlpha = 0.12 * st.fadeAlpha;
      hexPath(cx, stoneCY, S*1.02, BR, ELEV+8); ctx.fillStyle = "rgba(60,50,110,0.25)"; ctx.fill();
      // Side face (elevation depth)
      ctx.globalAlpha = st.fadeAlpha;
      hexPath(cx, stoneCY, S, BR, ELEV);
      const sg = ctx.createLinearGradient(cx, stoneCY, cx, stoneCY+ELEV);
      sg.addColorStop(0, "rgba(140,128,210,0.35)"); sg.addColorStop(1, "rgba(100,90,170,0.15)");
      ctx.fillStyle = sg; ctx.fill();
      // Main face — smooth violet-to-lavender gradient
      hexPath(cx, stoneCY, S, BR, 0);
      const stG = ctx.createLinearGradient(cx-S*0.7, stoneCY-S*0.8, cx+S*0.7, stoneCY+S*0.8);
      stG.addColorStop(0, "#b5a8f0"); stG.addColorStop(0.35, "#a4b4f4");
      stG.addColorStop(0.65, "#9ac2f4"); stG.addColorStop(1, "#92cee8");
      ctx.fillStyle = stG; ctx.fill();
      // Highlight
      ctx.globalAlpha = 0.35 * st.fadeAlpha;
      hexPath(cx, stoneCY-2, S*0.82, BR*0.8, 0);
      const hl = ctx.createLinearGradient(cx, stoneCY-S, cx, stoneCY);
      hl.addColorStop(0, "rgba(255,255,255,0.5)"); hl.addColorStop(0.6, "rgba(255,255,255,0.08)"); hl.addColorStop(1, "transparent");
      ctx.fillStyle = hl; ctx.fill();
      // Rim
      ctx.globalAlpha = st.fadeAlpha;
      hexPath(cx, stoneCY, S, BR, 0); ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();

      // Text
      ctx.globalAlpha = Math.min(st.fadeAlpha, 0.2);
      ctx.font = "600 11px 'DM Sans', sans-serif"; ctx.textAlign = "center"; ctx.letterSpacing = "3px";
      ctx.fillStyle = "#1a1a2e"; ctx.fillText("P A S O", cx, stoneCY + S + 36);
      ctx.globalAlpha = Math.min(st.fadeAlpha, 0.15);
      ctx.font = "italic 12px 'DM Sans', sans-serif";
      ctx.fillText(mob ? "Tap to take your first step" : "Click to take your first step", cx, stoneCY + S + 56);
      ctx.globalAlpha = 1;
    }

    function animate() {
      if (!st.pressed) st.floatT += 0.018;
      st.glowStr = 0.3 + Math.sin(st.floatT * 0.8) * 0.12;
      draw();
      animId = requestAnimationFrame(animate);
    }
    animate();

    const onMove = (e) => { st.mouseX = e.clientX; st.mouseY = e.clientY; };
    const onTouch = (e) => { st.mouseX = e.touches[0].clientX; st.mouseY = e.touches[0].clientY; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onTouch);

    const onClick = (e) => {
      if (st.pressed || st.fadeOut) return;
      const dx = e.clientX - cx, dy = e.clientY - (cy + Math.sin(st.floatT) * 5);
      if (Math.sqrt(dx*dx + dy*dy) > S * 2.2) return;
      st.pressed = true;
      onPressRef.current();
      // Press animation
      const dur = 650, start = performance.now();
      function animPress(now) {
        const t = Math.min((now - start) / dur, 1);
        if (t < 0.3) { st.stoneY = (t/0.3)*12; st.stoneScl = 1-(t/0.3)*0.04; st.glowStr = 0.35+(t/0.3)*0.5; }
        else if (t < 0.6) { const p=(t-0.3)/0.3; st.stoneY = 12-p*16; st.stoneScl = 0.96+p*0.06; st.glowStr = 0.85-p*0.3; }
        else { const p=(t-0.6)/0.4; st.stoneY = -4+p*4; st.stoneScl = 1.02-p*0.02; st.glowStr = 0.55-p*0.2; }
        if (t < 1) requestAnimationFrame(animPress);
        else { st.stoneY=0; st.stoneScl=1; st.fadeOut=true;
          const fs = performance.now();
          function animFade(n2) { const ft=Math.min((n2-fs)/700,1); st.fadeAlpha=1-ft; if(ft<1) requestAnimationFrame(animFade); }
          setTimeout(() => requestAnimationFrame(animFade), 200);
        }
      }
      requestAnimationFrame(animPress);
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      canvas.dispatchEvent(new MouseEvent("click", { clientX: t.clientX, clientY: t.clientY }));
    });

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      canvas.removeEventListener("click", onClick);
    };
  }, [mob]);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 200, display: "block", cursor: "pointer" }} />;
}

export default function PasoLive() {
  const mob = useIsMobile();
  const [inputValue, setInputValue] = useState("");
  const [step, setStep] = useState("intro");
  // stonePressed handled internally by IntroStone canvas
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
  const [credits, setCredits] = useState(0);
  const [selectedPack, setSelectedPack] = useState(null);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [checkedMilestones, setCheckedMilestones] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [shareId, setShareId] = useState(null);
  const [shareStatus, setShareStatus] = useState(""); // "", "saved", "copied", "error"
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);
  const [showInstallTip, setShowInstallTip] = useState(false);


  // Adjust roadmap
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustInput, setAdjustInput] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  // Weekly nudge (push notifications)
  const [showNudgeSetup, setShowNudgeSetup] = useState(false);
  const [nudgeSaved, setNudgeSaved] = useState(false);
  const [nudgeFrequency, setNudgeFrequency] = useState("weekly");
  const [pushStatus, setPushStatus] = useState("idle"); // idle, requesting, granted, denied, error
  const [userName, setUserName] = useState("");
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  // Accountability is inline now — no popup needed
  const [liveCount, setLiveCount] = useState(null);
  const phaseRefs = useRef([]);

  // PWA meta tags — NO MANIFEST on purpose
  // iOS behavior: WITH manifest → uses start_url (we can't control this dynamically)
  //               WITHOUT manifest → uses CURRENT BROWSER URL (exactly what we want!)
  // apple-mobile-web-app-capable gives standalone mode without needing a manifest.
  // After saving a roadmap, handleSave sets URL to /?r=shareId
  // When user taps "Add to Home Screen", iOS saves that URL.
  useEffect(() => {
    const ensureMeta = (name, content) => {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement("meta"); el.name = name; document.head.appendChild(el); }
      el.content = content;
    };
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    ensureMeta("apple-mobile-web-app-title", "Paso");
    ensureMeta("theme-color", "#6C5CE7");

    // REMOVE any manifest link that Next.js or previous code may have added
    // This is critical — if a manifest exists, iOS uses its start_url instead of the browser URL
    const existingManifest = document.querySelector('link[rel="manifest"]');
    if (existingManifest) existingManifest.remove();
  }, [shareId]);

  // Fetch live roadmap count
  useEffect(() => { fetchRoadmapCount().then((n) => { if (n > 0) setLiveCount(n); }); }, []);

  // Check URL for shared roadmap on mount — only ?r= query param or #/r/ hash
  // NO localStorage — each roadmap is accessed only by its URL.
  // PWA homescreen uses ?r= (browser URL saved by iOS), shared links use #/r/
  useEffect(() => {
    const hash = window.location.hash;
    const hashMatch = hash.match(/#\/r\/([a-z0-9]+)/);
    const urlParams = new URLSearchParams(window.location.search);
    const queryId = urlParams.get("r");

    // Priority: query param (PWA homescreen / saved) → hash (shared link)
    const idToLoad = queryId || (hashMatch ? hashMatch[1] : null);

    if (idToLoad) {
      // Normalize URL to always use ?r= format (iOS homescreen needs this)
      if (hashMatch && !queryId) {
        window.history.replaceState(null, "", `/?r=${hashMatch[1]}`);
      }
      setStep("loadingR");
      loadRoadmap(idToLoad).then((data) => {
        setRoadmap(data.roadmap_json ? (typeof data.roadmap_json === "string" ? JSON.parse(data.roadmap_json) : data.roadmap_json) : data.roadmap);
        setGoal(data.goal);
        setShareId(idToLoad);
        setIsSharedView(true);
        setUnlocked(true);
        setBreakdownCredits(-1);
        if (data.user_name) setUserName(data.user_name);
        if (data.progress && typeof data.progress === "object") {
          const { _credits: savedCredits, ...milestones } = data.progress;
          setCheckedMilestones(milestones);
          if (typeof savedCredits === "number" && savedCredits > 0) setCredits(savedCredits);
        }
        // Restore nudge state from Supabase
        if (data.nudge_enabled) {
          setNudgeSaved(true);
          if (data.nudge_frequency) setNudgeFrequency(data.nudge_frequency);
          // Check if push is still active in this browser
          if ("serviceWorker" in navigator && "PushManager" in window) {
            navigator.serviceWorker.ready.then((reg) => {
              reg.pushManager.getSubscription().then((sub) => {
                setPushStatus(sub ? "granted" : "idle");
              });
            }).catch(() => {});
          }
        }
        setStep("roadmap");
        // Show welcome-back popup if opened from homescreen (query param, not hash link)
        if (queryId) setTimeout(() => setShowWelcomeBack(true), 600);
        // iOS PWA blocks audio autoplay — even touchstart handlers can lose gesture context
        // Set sound OFF initially; user can tap the sound toggle (which works reliably)
        // OR: auto-resume on first tap by creating AudioContext synchronously in gesture
        setSoundEnabled(false);
        const startOnTap = async () => {
          try {
            // Create/resume AudioContext synchronously in gesture — iOS requires this
            if (typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined") {
              const AC = AudioContext || webkitAudioContext;
              const ctx = Tone.context.rawContext || new AC();
              if (ctx.state !== "running") ctx.resume();
            }
            await initAudio();
            if (audioReady) {
              setSoundEnabled(true);
              startAmbient();
              ambientPhase = 1; ambientElapsed = 40;
              try {
                fadeGain(synths.kalimbaGain, 0.09, 2);
                fadeGain(synths.padGain, 0.016, 2);
                synths.pad?.triggerAttackRelease(PAD_CHORDS[0], 18);
              } catch(e) {}
            }
          } catch(e) { console.warn("Audio start failed:", e); }
        };
        document.addEventListener("touchstart", startOnTap, { once: true });
        document.addEventListener("click", startOnTap, { once: true });
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
    if (step === "landing" || step === "intro") stopAmbient();
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
    setGoal(sanitize(inputValue, 500)); setStep("loadingQ"); setError(null);
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
      setRoadmap(data); setStep("teaser"); window.scrollTo(0, 0);
    } catch (err) { setError(err.message); setStep("questions"); }
  };

  const handleReset = () => {
    setStep("landing"); setRoadmap(null); setQuestions(null); setAnswers({}); setExtras({});
    setInputValue(""); setGoal(""); setError(null); setUnlocked(false); setSelectedPack(null); setHasPurchased(false); 
    setBreakdownCredits(0); setCheckedMilestones({}); setShowFinale(false);
    setFinaleTriggered(false); setShareId(null); setShareStatus(""); setIsSharedView(false);
    setNudgeSaved(false); setPushStatus("idle"); setUserName("");
    milestoneTickCount = 0; window.scrollTo(0, 0);
    // Clean URL — remove both query params and hash
    window.history.replaceState(null, "", window.location.pathname);
  };

  // Silent save — returns the shareId without showing popup
  const ensureSaved = async () => {
    if (shareId) return shareId;
    try {
      const id = await saveRoadmap(roadmap, Object.values(answers), goal);
      setShareId(id);
      window.history.replaceState(null, "", `/?r=${id}`);
      // Also save credits
      updateProgress(id, { ...checkedMilestones, _credits: credits });
      return id;
    } catch (e) {
      console.error("Auto-save error:", e);
      return null;
    }
  };

  const handleSave = async () => {
    if (shareId) { setShowSharePopup(true); return; }
    setShareStatus("saving");
    try {
      const id = await saveRoadmap(roadmap, Object.values(answers), goal);
      setShareId(id);
      // Use query param URL (not hash) — iOS saves the browser URL for homescreen
      // Hash fragments may be stripped, but ?r= survives
      window.history.replaceState(null, "", `/?r=${id}`);
      setShareStatus("saved");
      setTimeout(() => setShowSharePopup(true), 400);
    } catch (e) {
      console.error("Save error:", e);
      setShareStatus("error");
      setTimeout(() => setShareStatus(""), 3000);
    }
  };

  const getShareLink = () => {
    if (!shareId) return "";
    return `${window.location.origin}/?r=${shareId}`;
  };

  const copyLink = async () => {
    const link = getShareLink();
    try { await navigator.clipboard.writeText(link); } catch {}
    setShareStatus("copied");
    setTimeout(() => setShareStatus(""), 2500);
  };

  const shareWhatsApp = () => {
    const link = getShareLink();
    const text = "Check out my " + goal + " roadmap on Paso! Track my progress and keep me accountable\n" + link;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const shareText = () => {
    const link = getShareLink();
    const text = `Check out my ${goal} roadmap on Paso! ${link}`;
    if (navigator.share) {
      navigator.share({ title: `My ${goal} roadmap — Paso`, text, url: link }).catch(() => {});
    } else {
      window.open(`sms:?body=${encodeURIComponent(text)}`, "_blank");
    }
  };

  const handleNudgeSave = async () => {
    if (!shareId) return;

    // Check if push is supported
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;

    if (!("serviceWorker" in navigator)) {
      setPushStatus("unsupported");
      return;
    }
    if (!("PushManager" in window)) {
      setPushStatus(isIOS ? "ios-safari" : "unsupported");
      return;
    }
    if (!("Notification" in window)) {
      setPushStatus(isIOS ? "ios-safari" : "unsupported");
      return;
    }

    setPushStatus("requesting");
    try {
      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Request notification permission
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPushStatus("denied"); return; }

      // Subscribe to push
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) { console.error("VAPID key missing"); setPushStatus("error"); return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });
      const subJson = JSON.stringify(sub);

      // Save subscription + frequency to server
      await patchRoadmap(shareId, { push_subscription: subJson, nudge_enabled: true, nudge_frequency: nudgeFrequency, user_name: sanitize(userName, 50) || null });
      setPushStatus("granted");
      setNudgeSaved(true);
    } catch (e) {
      console.error("Push setup error:", e);
      if (isIOS && !isStandalone) {
        setPushStatus("ios-safari");
      } else {
        setPushStatus("error");
      }
    }
  };

  const handleNudgeDisable = async () => {
    if (!shareId) return;
    try {
      await patchRoadmap(shareId, { nudge_enabled: false });
      // Unsubscribe from push on this device
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      setNudgeSaved(false);
      setPushStatus("idle");
      setShowNudgeSetup(false);
    } catch (e) {
      console.error("Nudge disable error:", e);
    }
  };

  const sendTestPush = async () => {
    if (!nudgeSaved) return;
    setPushStatus("requesting");
    try {
      const m1 = roadmap?.phases?.[0]?.milestones?.[0] || "Your first milestone";
      const funTitles = userName
        ? [`Hey ${userName}, this is what it'll look like`, `${userName}, your weekly nudge`, `Test nudge for ${userName}!`]
        : ["This is what your nudge looks like", "Test nudge!", "Hey! Check this out"];
      const title = funTitles[Math.floor(Math.random() * funTitles.length)];
      const res = await fetch("/api/push", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          shareId,
          title,
          body: `Focus on: ${m1}. That's it. That's the whole plan.`,
          url: getShareLink() || window.location.href,
        }),
      });
      const data = await res.json();
      console.log("Push API response:", data);
      if (data.success) {
        setPushStatus("test-sent");
      } else {
        console.error("Push API error:", data);
        setPushStatus("test-error");
      }
    } catch (e) {
      console.error("Push fetch error:", e);
      setPushStatus("test-error");
    }
    setTimeout(() => setPushStatus("granted"), 4000);
  };

  // Adjust roadmap — send changes to AI (prompts are server-side)
  const handleAdjust = async () => {
    if (!adjustInput.trim() || adjusting) return;
    setAdjusting(true);
    try {
      // Build list of completed milestone texts so AI knows what to preserve
      const completedMilestones = [];
      Object.entries(checkedMilestones).forEach(([key, val]) => {
        if (val) {
          const [pi, mi] = key.split("-").map(Number);
          if (roadmap.phases[pi] && roadmap.phases[pi].milestones[mi]) {
            completedMilestones.push(roadmap.phases[pi].milestones[mi]);
          }
        }
      });

      const parsed = await adjustRoadmap(goal, roadmap, adjustInput, completedMilestones);

      // Check if AI flagged it as a new goal
      if (parsed.error === "NEW_GOAL") {
        setError(parsed.message || "This sounds like a new goal. Try 'Set your next goal' instead.");
        setTimeout(() => setError(null), 4000);
        setAdjusting(false);
        return;
      }

      if (parsed.phases) {
        // Match completed milestones by TEXT content, not index
        const newChecked = {};
        const completedSet = new Set(completedMilestones);
        parsed.phases.forEach((phase, pi) => {
          phase.milestones.forEach((milestone, mi) => {
            if (completedSet.has(milestone)) {
              newChecked[`${pi}-${mi}`] = true;
            }
          });
        });
        setRoadmap(parsed);
        setCheckedMilestones(newChecked);
        setShowAdjust(false);
        setAdjustInput("");
        if (shareId) {
          updateProgress(shareId, { ...newChecked, _credits: credits });
          try { await patchRoadmap(shareId, { roadmap: parsed, progress: { ...newChecked, _credits: credits } }); } catch {}
        }
        if (soundEnabled) playUnlockSound();
      }
    } catch (e) {
      console.error("Adjust error:", e);
      setError("Couldn't adjust roadmap. Try again.");
      setTimeout(() => setError(null), 3000);
    }
    setAdjusting(false);
  };

  const CREDIT_PACKS = { starter: 5, builder: 15, unlimited: 99 };

  const handleSelectPack = (packId) => {
    if (hasPurchased) return; // already bought
    setSelectedPack(packId);
  };

  const handleConfirmPurchase = () => {
    if (!selectedPack || hasPurchased) return;
    const amount = CREDIT_PACKS[selectedPack] || 0;
    // FAKE PAYWALL - replace with Stripe checkout later
    setCredits((prev) => {
      const newCredits = prev + amount;
      // Save credits to Supabase immediately if roadmap is saved
      if (shareId) {
        updateProgress(shareId, { ...checkedMilestones, _credits: newCredits });
      }
      return newCredits;
    });
    setHasPurchased(true);
    if (soundEnabled) playRevealChime();
  };

  const handleUnlock = () => {
    if (credits <= 0) return;
    const newCredits = credits - 1;
    setCredits(newCredits);
    if (soundEnabled) playUnlockSound();
    setUnlocked(true);
    setBreakdownCredits(-1);
    setStep("commitment");
    // Save updated credits
    if (shareId) {
      updateProgress(shareId, { ...checkedMilestones, _credits: newCredits });
    }
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

  // Debounced save progress to Supabase when milestones change
  const progressSaveRef = useRef(null);
  useEffect(() => {
    if (!shareId || Object.keys(checkedMilestones).length === 0) return;
    clearTimeout(progressSaveRef.current);
    progressSaveRef.current = setTimeout(() => {
      updateProgress(shareId, { ...checkedMilestones, _credits: credits });
    }, 1500);
    return () => clearTimeout(progressSaveRef.current);
  }, [checkedMilestones, shareId]);

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
        @keyframes fadeOut{from{opacity:1}to{opacity:0}}

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
            {/* Credits pill */}
            {credits > 0 && step === "roadmap" && (
              <span style={{ ...M, fontSize: 9, letterSpacing: "0.06em", color: ACCENT, background: "rgba(108,92,231,0.06)", padding: "4px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}>
                {Icon.check(10, ACCENT)}{credits} credits
              </span>
            )}
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

        {/* ━━━ INTRO — STEPPING STONE ━━━ */}
        {step === "intro" && <IntroStone mob={mob} onPress={() => {
          initAudio().then(() => {
            setSoundEnabled(true);
            playStonePress();
          }).catch(() => {});
          setTimeout(() => setStep("landing"), 1300);
        }} />}


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
                <span style={{ fontFamily: H, fontSize: 36, fontWeight: 400, color: INK }}>{liveCount !== null ? liveCount.toLocaleString() : "—"}</span>
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
        {/* TEASER - free action + paywall */}
        {step === "teaser" && roadmap && (
          <div style={{ animation: "fadeIn 0.8s ease both", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: mob ? 40 : 80 }}>
            <Reveal>
              <div style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT, opacity: 0.6, marginBottom: 12, textAlign: "center" }}>Your roadmap is ready</div>
              <h2 style={{ fontFamily: H, fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 400, color: INK, textAlign: "center", lineHeight: 1.3, marginBottom: 8 }}>{roadmap.goal}</h2>
              <p style={{ fontFamily: H, fontSize: 16, fontStyle: "italic", color: INK25, textAlign: "center", maxWidth: 440, marginBottom: 40 }}>{roadmap.tagline}</p>
            </Reveal>

            <Reveal delay={0.3}>
              <Glass style={{ maxWidth: 480, padding: mob ? "24px 24px" : "28px 32px", marginBottom: 32 }}>
                <div style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#00b894", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>{Icon.check(10, "#00b894")} Do this right now</div>
                <p style={{ ...B, fontSize: 16, color: INK70, lineHeight: 1.7, marginBottom: 8 }}>{roadmap.phases[0].actions[0]}</p>
                <p style={{ ...B, fontSize: 12, color: INK25, lineHeight: 1.5 }}>
                  This is step one of your {roadmap.timeline} roadmap. {roadmap.phases.length} phases, {roadmap.phases.reduce((s, p) => s + p.milestones.length, 0)} milestones ahead.
                </p>
              </Glass>
            </Reveal>

            <Reveal delay={0.5}>
              <div style={{ maxWidth: 480, width: "100%", marginBottom: 32, position: "relative" }}>
                <div style={{ filter: "blur(6px)", opacity: 0.5, pointerEvents: "none", userSelect: "none" }}>
                  {roadmap.phases.map((phase, i) => (
                    <div key={i} style={{ padding: "14px 18px", marginBottom: 8, borderRadius: 12, background: "rgba(108,92,231,0.03)", border: "1px solid rgba(108,92,231,0.06)" }}>
                      <div style={{ ...M, fontSize: 10, color: ACCENT, marginBottom: 4 }}>{phase.weeks}</div>
                      <div style={{ ...B, fontSize: 14, color: INK50, fontWeight: 500 }}>{phase.title}</div>
                      <div style={{ ...B, fontSize: 11, color: INK25, marginTop: 4 }}>{phase.milestones.length} milestones</div>
                    </div>
                  ))}
                </div>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{Icon.lock(24, INK30)}</div>
              </div>
            </Reveal>

            <Reveal delay={0.7}>
              <Glass style={{ maxWidth: 480, padding: mob ? "28px 24px" : "32px 36px", marginBottom: 24 }}>
                <p style={{ fontFamily: H, fontSize: mob ? 20 : 24, fontWeight: 400, color: INK, lineHeight: 1.5, marginBottom: 16 }}>You just took your first step.</p>
                <p style={{ ...B, fontSize: 14, color: INK50, lineHeight: 1.7, marginBottom: 12 }}>
                  But a single action is not a plan. 92% of goals fail without a system. Life coaches cost over 200 an hour. Habit apps charge 5/month and still leave the planning to you.
                </p>
                <p style={{ ...B, fontSize: 14, color: INK60, lineHeight: 1.7, marginBottom: 20 }}>
                  Paso gives you a full AI roadmap with checkable milestones, weekly accountability nudges, calendar scheduling, and scientific references. All for the price of a coffee.
                </p>
                <p style={{ ...M, fontSize: 11, color: INK30, marginBottom: 20 }}>Most people use 8-12 credits to go from idea to done.</p>
                {!hasPurchased ? (<>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      { id: "starter", name: "Starter", cr: 5, price: "\u20ac3", sub: "1 roadmap + extras" },
                      { id: "builder", name: "Builder", cr: 15, price: "\u20ac7", sub: "Most popular", tag: true },
                      { id: "unlimited", name: "Unlimited", cr: 99, price: "\u20ac12/mo", sub: "Unlimited roadmaps" },
                    ].map((pack) => {
                      const selected = selectedPack === pack.id;
                      return (
                        <button key={pack.id} onClick={() => handleSelectPack(pack.id)} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "14px 20px", borderRadius: 14, cursor: "pointer",
                          border: selected ? `2px solid ${ACCENT}` : "1px solid rgba(26,26,46,0.08)",
                          background: selected ? "rgba(108,92,231,0.06)" : "rgba(255,255,255,0.6)",
                          transition: "all 0.25s ease", position: "relative",
                          transform: selected ? "scale(1.02)" : "scale(1)",
                          boxShadow: selected ? "0 2px 16px rgba(108,92,231,0.15)" : "none",
                        }}>
                          {pack.tag && !selected && <span style={{ position: "absolute", top: -9, right: 14, ...M, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", background: ACCENT, color: "#fff", padding: "3px 10px", borderRadius: 6 }}>Most popular</span>}
                          {selected && <span style={{ position: "absolute", top: -9, right: 14, ...M, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", background: ACCENT, color: "#fff", padding: "3px 10px", borderRadius: 6 }}>Selected</span>}
                          <div style={{ textAlign: "left" }}>
                            <div style={{ ...B, fontSize: 15, color: selected ? INK : INK70, fontWeight: 600 }}>{pack.name}</div>
                            <div style={{ ...M, fontSize: 10, color: selected ? INK45 : INK25, marginTop: 2 }}>{pack.cr} credits &middot; {pack.sub}</div>
                          </div>
                          <div style={{ ...M, fontSize: 18, color: ACCENT, fontWeight: 700 }}>{pack.price}</div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedPack && (
                    <button onClick={handleConfirmPurchase} style={{
                      ...M, fontSize: 13, letterSpacing: "0.04em", padding: "15px 32px", borderRadius: 14,
                      border: "none", background: ACCENT, color: "#fff", fontWeight: 600,
                      cursor: "pointer", boxShadow: "0 4px 24px rgba(108,92,231,0.3)",
                      width: "100%", marginTop: 16, transition: "all 0.3s ease",
                      animation: "slideUp 0.3s ease both",
                    }}>
                      Get {CREDIT_PACKS[selectedPack]} credits &rarr;
                    </button>
                  )}
                  <p style={{ ...M, fontSize: 9, color: INK22, textAlign: "center", marginTop: 14, letterSpacing: "0.04em" }}>Secure checkout coming soon.</p>
                </>) : (
                  <div style={{ animation: "slideUp 0.5s ease both" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 0", marginBottom: 12 }}>
                      {Icon.check(14, "#00b894")}
                      <span style={{ ...M, fontSize: 12, color: "#00b894" }}>{credits} credits added to your account</span>
                    </div>
                    <button onClick={handleUnlock} style={{
                      ...M, fontSize: 14, letterSpacing: "0.04em", padding: "16px 32px", borderRadius: 14,
                      border: "none", background: ACCENT, color: "#fff", fontWeight: 600,
                      cursor: "pointer", boxShadow: "0 4px 24px rgba(108,92,231,0.3)",
                      width: "100%", transition: "all 0.3s ease",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}>
                      Unlock my full roadmap (1 credit)
                    </button>
                    <p style={{ ...M, fontSize: 10, color: INK25, textAlign: "center", marginTop: 10 }}>
                      {credits - 1} credits will remain for breakdowns, adjustments, and new roadmaps.
                    </p>
                  </div>
                )}
              </Glass>
            </Reveal>

            <Reveal delay={0.9}>
              <div style={{ maxWidth: 480, textAlign: "center", padding: "24px 0 48px" }}>
                <p style={{ fontFamily: H, fontSize: 14, fontStyle: "italic", color: INK22, marginBottom: 10 }}>"But can't I just use ChatGPT?"</p>
                <p style={{ ...B, fontSize: 12, color: INK25, lineHeight: 1.65, maxWidth: 380, margin: "0 auto" }}>
                  ChatGPT gives you a wall of text that disappears when you close the tab. Paso gives you a system that lives on your homescreen and keeps showing up until you finish.
                </p>
              </div>
            </Reveal>
          </div>
        )}

        {/* COMMITMENT - motivational moment before roadmap */}
        {step === "commitment" && roadmap && (
          <div style={{ animation: "fadeIn 0.8s ease both", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 24px" }}>
            <Reveal>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(108,92,231,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 28px" }}>
                {Icon.check(24, ACCENT)}
              </div>
            </Reveal>
            <Reveal delay={0.2}>
              <p style={{ ...M, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT, opacity: 0.6, marginBottom: 16 }}>Thank you</p>
            </Reveal>
            <Reveal delay={0.4}>
              <h2 style={{ fontFamily: H, fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 400, color: INK, lineHeight: 1.4, maxWidth: 440, marginBottom: 16 }}>
                This is a commitment to yourself.
              </h2>
            </Reveal>
            <Reveal delay={0.6}>
              <p style={{ ...B, fontSize: 15, color: INK45, lineHeight: 1.7, maxWidth: 400, marginBottom: 12 }}>
                You are doing this to become the person you already know you can be. 
                We are here to support you every step of the way, even when the path changes.
              </p>
            </Reveal>
            <Reveal delay={0.8}>
              <p style={{ fontFamily: H, fontSize: 16, fontStyle: "italic", color: INK25, maxWidth: 360, marginBottom: 40 }}>
                Your roadmap. Your pace. Your future.
              </p>
            </Reveal>
            <Reveal delay={1.0}>
              <button onClick={() => setStep("roadmap")} style={{
                ...M, fontSize: 14, letterSpacing: "0.06em", padding: "16px 40px", borderRadius: 14,
                border: "none", background: ACCENT, color: "#fff", fontWeight: 600,
                cursor: "pointer", boxShadow: "0 4px 24px rgba(108,92,231,0.3)",
                transition: "all 0.3s ease",
              }}>
                Now go get it &rarr;
              </button>
            </Reveal>
            <Reveal delay={1.2}>
              <p style={{ ...M, fontSize: 10, color: INK22, marginTop: 20 }}>
                {credits} credits remaining
              </p>
            </Reveal>
          </div>
        )}

        {step === "roadmap" && roadmap && (
          <>
            {/* Shared view banner */}
            {isSharedView && (
              <div style={{ animation: "fadeIn 0.5s ease both", marginTop: 12, marginBottom: -20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderRadius: 12, background: "rgba(108,92,231,0.04)", border: "1px solid rgba(108,92,231,0.1)", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ ...B, fontSize: 12, color: INK30 }}>You're viewing a shared roadmap · progress saves automatically</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setShowInstallTip(true)}
                      style={{ ...M, fontSize: 10, letterSpacing: "0.04em", padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(108,92,231,0.15)", background: "rgba(255,255,255,0.5)", color: ACCENT, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                      {Icon.bookmark(12, ACCENT)} Save to homescreen
                    </button>
                    <button onClick={() => { setIsSharedView(false); handleReset(); }}
                      style={{ ...M, fontSize: 10, letterSpacing: "0.04em", padding: "6px 14px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", cursor: "pointer" }}>
                      Make your own
                    </button>
                  </div>
                </div>
                {showInstallTip && (
                  <div style={{ animation: "slideUp 0.3s ease both", marginTop: 8, padding: "16px 20px", borderRadius: 14, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.6)", position: "relative" }}>
                    <button onClick={() => setShowInstallTip(false)} style={{ position: "absolute", top: 10, right: 14, background: "none", border: "none", cursor: "pointer", ...M, fontSize: 12, color: INK25 }}>✕</button>
                    <div style={{ ...M, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT, marginBottom: 10 }}>Save for easy access</div>
                    <div style={{ ...B, fontSize: 13, color: INK45, lineHeight: 1.7 }}>
                      <strong style={{ color: INK60 }}>iPhone/iPad:</strong> Tap the share button (□↑) in Safari → "Add to Home Screen"<br/>
                      <strong style={{ color: INK60 }}>Android:</strong> Tap ⋮ menu in Chrome → "Add to Home Screen"<br/>
                      <strong style={{ color: INK60 }}>Desktop:</strong> Bookmark this page (⌘/Ctrl + D)
                    </div>
                    <div style={{ ...B, fontSize: 11, color: INK25, marginTop: 8 }}>Your progress is saved to the link — come back anytime and pick up where you left off.</div>
                  </div>
                )}
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
                    
                  }}>
                    <span style={{ opacity: 0.4 }}>{String(i + 1).padStart(2, "0")}</span> {p.title}
                    
                  </div>
                ))}
              </div>

              {/* Paywall CTA */}


              {/* Accountability + Save/Share section */}
              <div style={{ animation: "slideUp 1s cubic-bezier(0.16,1,0.3,1) 0.95s both", marginTop: 48 }}>
                <Glass style={{ padding: mob ? "24px 20px" : "28px 32px" }}>
                  <p style={{ ...B, fontSize: 13, color: INK45, lineHeight: 1.7, marginBottom: 6 }}>
                    People who write down their goals and have weekly accountability are <strong style={{ color: INK60 }}>42% more likely</strong> to achieve them (Matthews, 2015).
                    Save your roadmap, turn on nudges, and schedule milestones to your calendar to stay on track.
                  </p>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                    {/* Save + homescreen */}
                    <button onClick={async () => {
                      await ensureSaved();
                      setShowInstallTip((v) => !v);
                    }} style={{
                      ...M, fontSize: 11, letterSpacing: "0.04em", padding: "10px 18px", borderRadius: 12,
                      border: "none", background: ACCENT, color: "#fff", fontWeight: 600,
                      cursor: "pointer", boxShadow: "0 2px 12px rgba(108,92,231,0.2)",
                      display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
                    }}>
                      {Icon.bookmark(12, "#fff")} {shareId ? "Add to homescreen" : "Save & add to homescreen"}
                    </button>

                    {/* Share */}
                    <button onClick={async () => {
                      await ensureSaved();
                      setShowSharePopup(true);
                    }} style={{
                      ...M, fontSize: 11, letterSpacing: "0.04em", padding: "10px 18px", borderRadius: 12,
                      border: "1px solid rgba(108,92,231,0.15)", background: "rgba(255,255,255,0.5)",
                      color: ACCENT, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
                    }}>
                      {Icon.share(12, ACCENT)} Share
                    </button>

                    {/* Nudges */}
                    {!nudgeSaved && (
                      <button onClick={async () => {
                        await ensureSaved();
                        setShowNudgeSetup(true);
                      }} style={{
                        ...M, fontSize: 11, letterSpacing: "0.04em", padding: "10px 18px", borderRadius: 12,
                        border: "1px solid rgba(108,92,231,0.15)", background: "rgba(255,255,255,0.5)",
                        color: ACCENT, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
                      }}>
                        {Icon.bell(12, ACCENT)} Weekly nudges
                      </button>
                    )}
                    {nudgeSaved && (
                      <span style={{ ...M, fontSize: 10, color: "#00b894", display: "flex", alignItems: "center", gap: 4, padding: "10px 14px" }}>
                        {Icon.check(10, "#00b894")} Nudges active
                      </span>
                    )}
                  </div>

                  {/* Install tip inline */}
                  {showInstallTip && (
                    <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 12, background: "rgba(108,92,231,0.03)", border: "1px solid rgba(108,92,231,0.08)" }}>
                      <div style={{ ...B, fontSize: 12, color: INK45, lineHeight: 1.7 }}>
                        <strong style={{ color: INK60 }}>iPhone/iPad:</strong> Tap share (&#x25A1;&#x2191;) in Safari &rarr; "Add to Home Screen"<br/>
                        <strong style={{ color: INK60 }}>Android:</strong> Tap &#x22EE; in Chrome &rarr; "Add to Home Screen"<br/>
                        <strong style={{ color: INK60 }}>Desktop:</strong> Bookmark this page (&#x2318;/Ctrl + D)
                      </div>
                      <p style={{ ...B, fontSize: 11, color: INK25, marginTop: 6 }}>Your progress saves automatically. Come back anytime.</p>
                    </div>
                  )}

                  {shareId && (
                    <p style={{ ...M, fontSize: 9, color: INK22, marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
                      {Icon.check(8, "#00b894")} Saved &middot; your progress syncs automatically
                    </p>
                  )}
                </Glass>
              </div>

              {unlocked && (
                <div style={{ marginTop: 48, display: "flex", alignItems: "center", gap: 10, animation: "fadeIn 1s ease 1.2s both" }}>
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
                <PhaseSection phase={phase} index={i} goal={roadmap.goal}
                    checkedMilestones={checkedMilestones} onToggleMilestone={toggleMilestone}
                    canBreakdown={canBreakdown} onUseCredit={useBreakdownCredit} onBuyBreakdown={handleBuyBreakdown} />
              </div>
            ))}




            

            {/* ━━━ CLOSING (unlocked) ━━━ */}
            {unlocked && (
              <section style={{ minHeight: "55vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", position: "relative" }}>
                <Reveal>
                  <div style={{ width: 48, height: 1, background: "rgba(108,92,231,0.12)", margin: "0 auto 32px" }} />
                </Reveal>

                {/* Progress summary */}
                <Reveal delay={0.08}>
                  <Glass style={{ padding: mob ? "14px 18px" : "18px 28px", marginBottom: 32, display: "flex", flexDirection: mob ? "column" : "row", alignItems: "center", gap: mob ? 10 : 16 }}>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
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
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(auto-fit, minmax(120px, auto))", gap: mob ? 8 : 12, justifyContent: "center", justifyItems: "center" }}>
                    <button onClick={handleSave}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: shareStatus === "copied" ? "rgba(85,239,196,0.12)" : shareStatus === "saved" ? "rgba(108,92,231,0.08)" : "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: shareStatus === "copied" ? "1px solid rgba(85,239,196,0.3)" : shareStatus === "saved" ? `1px solid ${ACCENT}30` : "1px solid rgba(255,255,255,0.5)", color: shareStatus === "copied" ? "#00b894" : shareStatus === "saved" ? ACCENT : INK40, cursor: "pointer", transition: "all 0.3s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {shareStatus === "saving" ? "Saving..." : shareStatus === "error" ? "Failed — try again" : shareStatus === "copied" ? "Link copied!" : shareId ? <>{Icon.share(14, ACCENT)} Share</> : <>{Icon.bookmark(14, INK40)} Save</>}
                    </button>
                    <button onClick={exportPDF}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)", color: INK40, cursor: "pointer", transition: "all 0.3s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {Icon.doc(14, INK40)} Export as PDF
                    </button>
                    <button onClick={() => setShowAdjust(true)}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)", color: INK40, cursor: "pointer", transition: "all 0.3s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {Icon.adjust(14, INK40)} Adjust plan
                    </button>
                    {allComplete ? (
                      <button onClick={() => { handleReset(); }}
                        style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, gridColumn: mob ? "1 / -1" : "auto" }}>
                        Set your next goal {Icon.arrow(11, "#fff")}
                      </button>
                    ) : (
                      <>
                        <button onClick={handleReset}
                          style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)", color: INK40, cursor: "pointer", transition: "all 0.3s ease" }}>
                          New goal
                        </button>
                        <button onClick={startDayOne}
                          style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 28px", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 20px rgba(108,92,231,0.25)", gridColumn: mob ? "1 / -1" : "auto" }}>
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
                    <button onClick={handleSave}
                      style={{ ...M, fontSize: 11, letterSpacing: "0.04em", padding: "13px 24px", borderRadius: 14, background: shareStatus === "copied" ? "rgba(85,239,196,0.12)" : "rgba(255,255,255,0.5)", backdropFilter: "blur(16px)", border: shareStatus === "copied" ? "1px solid rgba(85,239,196,0.3)" : "1px solid rgba(255,255,255,0.6)", color: shareStatus === "copied" ? "#00b894" : INK40, cursor: "pointer", width: mob ? "100%" : "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {shareStatus === "copied" ? "Link copied!" : shareId ? <>{Icon.share(14, ACCENT)} Share</> : <>{Icon.bookmark(14, INK40)} Save</>}
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

      {/* ━━━ SHARE POPUP ━━━ */}
      {showSharePopup && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1100,
          background: "rgba(26,26,46,0.35)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: mob ? 20 : 40, animation: "fadeIn 0.25s ease both",
        }} onClick={() => setShowSharePopup(false)}>
          <div style={{
            background: "rgba(255,255,255,0.88)", backdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.6)", borderRadius: 24,
            padding: mob ? "28px 24px" : "36px 40px", maxWidth: 440, width: "100%",
            boxShadow: "0 24px 80px rgba(0,0,0,0.12)",
            animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT }}>Share your roadmap</div>
              <button onClick={() => setShowSharePopup(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>{Icon.close(14, INK25)}</button>
            </div>

            <h3 style={{ fontFamily: H, fontSize: 22, fontWeight: 400, color: INK, marginBottom: 8 }}>Keep each other accountable</h3>
            <p style={{ ...B, fontSize: 13, color: INK30, lineHeight: 1.6, marginBottom: 28 }}>
              Share your roadmap with friends so they can track your progress — and you can track theirs. Accountability makes the difference between planning and doing.
            </p>

            {/* Share options */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              <button onClick={() => { shareWhatsApp(); }} style={{
                ...M, fontSize: 13, padding: "14px 20px", borderRadius: 14, border: "none", cursor: "pointer",
                background: "#25D366", color: "#fff", display: "flex", alignItems: "center", gap: 10, transition: "all 0.2s ease",
              }}>{Icon.whatsapp(18, "#fff")} Share on WhatsApp</button>

              <button onClick={shareText} style={{
                ...M, fontSize: 13, padding: "14px 20px", borderRadius: 14, border: "1px solid rgba(26,26,46,0.08)", cursor: "pointer",
                background: "rgba(255,255,255,0.6)", color: INK60, display: "flex", alignItems: "center", gap: 10, transition: "all 0.2s ease",
              }}>{Icon.message(16, INK40)} Share via text</button>

              <button onClick={copyLink} style={{
                ...M, fontSize: 13, padding: "14px 20px", borderRadius: 14, border: "1px solid rgba(26,26,46,0.08)", cursor: "pointer",
                background: shareStatus === "copied" ? "rgba(85,239,196,0.1)" : "rgba(255,255,255,0.6)",
                color: shareStatus === "copied" ? "#00b894" : INK60,
                display: "flex", alignItems: "center", gap: 10, transition: "all 0.2s ease",
              }}>{Icon.clipboard(16, shareStatus === "copied" ? "#00b894" : INK40)} {shareStatus === "copied" ? "Link copied!" : "Copy link"}</button>
            </div>

            {/* Add to homescreen — mobile only */}
            {mob && (
              <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(108,92,231,0.04)", border: "1px solid rgba(108,92,231,0.08)", marginBottom: 20 }}>
                <div style={{ ...M, fontSize: 11, color: ACCENT, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>{Icon.bookmark(12, ACCENT)} Add to homescreen</div>
                <p style={{ ...B, fontSize: 12, color: INK30, lineHeight: 1.5 }}>
                  Tap the share button (□↑) in Safari or ⋮ in Chrome → "Add to Home Screen". Your roadmap will open automatically every time — like a native app.
                </p>
              </div>
            )}

            {/* Weekly nudge opt-in */}
            {!showNudgeSetup && !nudgeSaved && (
              <button onClick={() => setShowNudgeSetup(true)} style={{
                ...M, fontSize: 12, width: "100%", padding: "14px 20px", borderRadius: 14,
                border: `1px dashed ${ACCENT}30`, cursor: "pointer",
                background: "transparent", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>{Icon.bell(14, ACCENT)} Set up accountability nudges</button>
            )}

            {showNudgeSetup && !nudgeSaved && (
              <div style={{ animation: "slideUp 0.3s ease both" }}>
                <div style={{ ...M, fontSize: 11, color: ACCENT, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>{Icon.bell(14, ACCENT)} Accountability nudges</div>
                <p style={{ ...B, fontSize: 12, color: INK30, lineHeight: 1.5, marginBottom: 14 }}>
                  Get a notification with your next milestones and a motivational nudge. We'll keep you on track.
                </p>

                {/* Name input */}
                <input
                  value={userName} onChange={(e) => setUserName(e.target.value)}
                  placeholder="What should we call you?"
                  style={{ width: "100%", ...B, fontSize: 14, padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(26,26,46,0.08)", background: "rgba(255,255,255,0.7)", outline: "none", marginBottom: 12, boxSizing: "border-box" }}
                />

                {/* Frequency picker */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {[["weekly", "Every Monday"], ["biweekly", "Every 2 weeks"], ["monthly", "Monthly"]].map(([val, label]) => (
                    <button key={val} onClick={() => setNudgeFrequency(val)} style={{
                      ...M, fontSize: 11, padding: "8px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s ease",
                      border: nudgeFrequency === val ? `1.5px solid ${ACCENT}` : "1px solid rgba(26,26,46,0.06)",
                      background: nudgeFrequency === val ? `${ACCENT}10` : "rgba(255,255,255,0.5)",
                      color: nudgeFrequency === val ? ACCENT : INK30,
                    }}>{label}</button>
                  ))}
                </div>

                <button onClick={handleNudgeSave} disabled={pushStatus === "requesting" || pushStatus === "ios-safari" || pushStatus === "unsupported"} style={{
                  ...M, fontSize: 12, width: "100%", padding: "13px 20px", borderRadius: 12, border: "none",
                  cursor: (pushStatus === "requesting" || pushStatus === "ios-safari" || pushStatus === "unsupported") ? "default" : "pointer",
                  background: (pushStatus === "denied" || pushStatus === "ios-safari" || pushStatus === "unsupported") ? "rgba(108,92,231,0.08)" : ACCENT,
                  color: (pushStatus === "denied" || pushStatus === "ios-safari" || pushStatus === "unsupported") ? ACCENT : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: pushStatus === "requesting" ? 0.7 : 1, transition: "all 0.2s ease",
                }}>{Icon.bell(14, (pushStatus === "denied" || pushStatus === "ios-safari" || pushStatus === "unsupported") ? ACCENT : "#fff")} {
                  pushStatus === "requesting" ? "Setting up..." :
                  pushStatus === "denied" ? "Blocked — check browser settings" :
                  pushStatus === "ios-safari" ? "Add Paso to homescreen first" :
                  pushStatus === "unsupported" ? "Not supported in this browser" :
                  pushStatus === "error" ? "Something went wrong — try again" :
                  "Enable notifications"
                }</button>

                <p style={{ ...B, fontSize: 10, color: INK22, lineHeight: 1.5, marginTop: 8 }}>
                  {pushStatus === "ios-safari"
                    ? "On iPhone, tap the share button (□↑) → \"Add to Home Screen\" first, then open Paso from your homescreen and enable nudges."
                    : mob ? "Works best when you add Paso to your homescreen." : "You can disable notifications anytime in your browser settings."}
                </p>
              </div>
            )}

            {nudgeSaved && (
              <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(85,239,196,0.08)", border: "1px solid rgba(85,239,196,0.15)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  {Icon.check(14, "#00b894")}
                  <span style={{ ...M, fontSize: 12, color: "#00b894" }}>Nudges activated!</span>
                </div>
                <p style={{ ...B, fontSize: 11, color: INK30, lineHeight: 1.5, marginBottom: 10 }}>
                  {nudgeFrequency === "weekly" ? "Every Monday" : nudgeFrequency === "biweekly" ? "Every other Monday" : "First Monday of the month"}, you'll get a notification with your next milestones + a motivational quote.
                </p>
                <button onClick={sendTestPush} style={{
                  ...M, fontSize: 11, width: "100%", padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                  border: pushStatus === "test-sent" ? "1px solid rgba(85,239,196,0.3)" : pushStatus === "test-error" ? "1px solid rgba(231,76,60,0.2)" : "1px solid rgba(108,92,231,0.2)",
                  background: pushStatus === "test-sent" ? "rgba(85,239,196,0.06)" : pushStatus === "test-error" ? "rgba(231,76,60,0.06)" : "rgba(108,92,231,0.06)",
                  color: pushStatus === "test-sent" ? "#00b894" : pushStatus === "test-error" ? "#e74c3c" : ACCENT,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>{pushStatus === "requesting" ? "Sending..." : pushStatus === "test-sent" ? "Sent! Check your notifications" : pushStatus === "test-error" ? "Failed — check console for details" : "Send test notification"}</button>
                <button onClick={handleNudgeDisable} style={{
                  ...M, fontSize: 11, width: "100%", padding: "10px 16px", borderRadius: 10, cursor: "pointer", marginTop: 6,
                  border: "1px solid rgba(26,26,46,0.06)", background: "transparent", color: INK25,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>Turn off nudges</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ━━━ WELCOME BACK POPUP ━━━ */}
      {showWelcomeBack && roadmap && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1200,
          background: "rgba(26,26,46,0.3)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: mob ? "flex-end" : "center", justifyContent: "center",
          padding: mob ? 0 : 40, animation: "fadeIn 0.3s ease both",
        }} onClick={() => setShowWelcomeBack(false)}>
          <div style={{
            background: "rgba(255,255,255,0.94)", backdropFilter: "blur(24px)",
            borderRadius: mob ? "28px 28px 0 0" : 28, padding: mob ? "32px 24px 40px" : "36px 36px 32px",
            maxWidth: 440, width: "100%", textAlign: "center",
            boxShadow: "0 20px 60px rgba(26,26,46,0.12)", animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Greeting */}
            <div style={{ fontSize: 32, marginBottom: 16 }}>👋</div>
            <h3 style={{ fontFamily: H, fontSize: 22, fontWeight: 400, color: INK, marginBottom: 8 }}>
              {userName ? `Welcome back, ${userName}!` : "Welcome back!"}
            </h3>
            <p style={{ ...B, fontSize: 13, color: INK30, lineHeight: 1.6, marginBottom: 24 }}>
              {(() => {
                const quotes = [
                  "The path is made by walking. Let's keep going.",
                  "Small steps every day add up to big results.",
                  "You showed up. That's already half the battle.",
                  "Consistency beats intensity. Always.",
                  "Every milestone checked is proof you can do this.",
                ];
                return quotes[Math.floor(Math.random() * quotes.length)];
              })()}
            </p>

            {/* Focus milestones */}
            <div style={{ textAlign: "left", padding: "16px 18px", borderRadius: 14, background: "rgba(108,92,231,0.04)", border: "1px solid rgba(108,92,231,0.08)", marginBottom: 20 }}>
              <div style={{ ...M, fontSize: 10, letterSpacing: "0.1em", color: ACCENT, marginBottom: 10, textTransform: "uppercase" }}>Focus on next</div>
              {roadmap.phases && roadmap.phases.flatMap((p, pi) =>
                p.milestones.map((m, mi) => ({ m, key: `${pi}-${mi}`, done: checkedMilestones[`${pi}-${mi}`] }))
              ).filter(x => !x.done).slice(0, 2).map((x, i) => (
                <div key={x.key} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: i === 0 ? 8 : 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: ACCENT, marginTop: 5, flexShrink: 0 }} />
                  <span style={{ ...B, fontSize: 13, color: INK60, lineHeight: 1.5 }}>{x.m}</span>
                </div>
              ))}
            </div>

            <button onClick={() => { setShowWelcomeBack(false); }} style={{
              ...M, fontSize: 12, width: "100%", padding: "14px 24px", borderRadius: 14,
              border: "none", background: ACCENT, color: "#fff", cursor: "pointer",
              boxShadow: "0 4px 20px rgba(108,92,231,0.25)",
            }}>Let's get to it →</button>
          </div>
        </div>
      )}

      {/* ━━━ ADJUST ROADMAP OVERLAY ━━━ */}
      {showAdjust && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1100,
          background: "rgba(26,26,46,0.35)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: mob ? "flex-end" : "center", justifyContent: "center",
          padding: mob ? 0 : 40, animation: "fadeIn 0.25s ease both",
        }} onClick={() => !adjusting && setShowAdjust(false)}>
          <div style={{
            background: "rgba(255,255,255,0.92)", backdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.6)",
            borderRadius: mob ? "24px 24px 0 0" : 24,
            padding: mob ? "28px 24px 36px" : "36px 40px", maxWidth: 500, width: "100%",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.08)",
            animation: mob ? "slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both" : "slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ ...M, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT, display: "flex", alignItems: "center", gap: 6 }}>{Icon.adjust(12, ACCENT)} Adjust your roadmap</div>
              <button onClick={() => setShowAdjust(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>{Icon.close(14, INK25)}</button>
            </div>

            <h3 style={{ fontFamily: H, fontSize: 22, fontWeight: 400, color: INK, marginBottom: 8 }}>Things changed?</h3>
            <p style={{ ...B, fontSize: 13, color: INK30, lineHeight: 1.6, marginBottom: 16 }}>
              Tell Paso what's different. Your plan will adapt while keeping the progress you've already made.
            </p>

            {error && (
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(232,93,117,0.08)", border: "1px solid rgba(232,93,117,0.15)", marginBottom: 14 }}>
                <span style={{ ...B, fontSize: 12, color: "rgba(232,93,117,0.8)" }}>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {["I got injured", "Timeline changed", "Got a mentor", "Budget shifted", "New opportunity"].map((s) => (
                  <button key={s} onClick={() => setAdjustInput(s + " — ")}
                    style={{ ...M, fontSize: 10, padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(26,26,46,0.06)", background: "rgba(255,255,255,0.5)", color: INK30, cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
              <textarea
                value={adjustInput} onChange={(e) => setAdjustInput(e.target.value)}
                placeholder="E.g. I got injured and can't run for 3 weeks, or I found a co-founder who handles marketing..."
                rows={3}
                style={{ ...B, fontSize: 14, padding: "14px 16px", borderRadius: 14, border: `1px solid ${adjustInput.trim() ? ACCENT + "30" : "rgba(26,26,46,0.08)"}`, background: "rgba(255,255,255,0.7)", outline: "none", resize: "none", transition: "border 0.3s ease", lineHeight: 1.5 }}
              />
            </div>

            <button onClick={handleAdjust} disabled={!adjustInput.trim() || adjusting}
              style={{
                ...M, fontSize: 12, letterSpacing: "0.04em", width: "100%", padding: "14px 24px",
                borderRadius: 14, border: "none", cursor: adjustInput.trim() && !adjusting ? "pointer" : "default",
                background: adjustInput.trim() && !adjusting ? ACCENT : "rgba(26,26,46,0.06)",
                color: adjustInput.trim() && !adjusting ? "#fff" : INK25,
                transition: "all 0.3s ease",
                boxShadow: adjustInput.trim() && !adjusting ? "0 4px 20px rgba(108,92,231,0.25)" : "none",
              }}>
              {adjusting ? "Adjusting your roadmap..." : "Adjust my roadmap →"}
            </button>

            {!adjusting && adjustInput.trim() && (
              <div style={{ marginTop: 8, ...B, fontSize: 11, color: INK22, textAlign: "center" }}>
                This usually takes about 20-30 seconds
              </div>
            )}

            {adjusting && (
              <div style={{ marginTop: 12, ...B, fontSize: 12, color: INK25, textAlign: "center" }}>
                Paso is rethinking your plan while keeping your progress... ~20s
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
