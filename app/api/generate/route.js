// app/api/generate/route.js
// All Claude prompts live here — the frontend never sees them.
// Frontend sends: { action, goal, answers?, extras?, phase?, mode?, roadmap?, adjustInput?, checkedMilestones? }

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { apiGuard, handleCORS } from "@/lib/api-guard";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var

// Handle CORS preflight
export async function OPTIONS(request) {
  return handleCORS(request);
}

// ─── PROMPT TEMPLATES (hidden from frontend) ───

const PROMPTS = {
  questions: (goal) => ({
    system: `You are Paso, an AI roadmap generator. Given a goal, generate smart follow-up questions to personalize the roadmap.

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
    user: `Goal: ${goal}`,
    maxTokens: 1024,
  }),

  roadmap: (goal, context) => ({
    system: `You are Paso, an AI roadmap generator by Numina Labs. Create a deeply personalized, evidence-based roadmap.

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
    user: `Goal: ${goal}\n\nContext:\n${context}`,
    maxTokens: 4096,
  }),

  breakdown: (goal, phase, mode) => {
    const system = mode === "mini"
      ? `You are Paso, an AI roadmap generator. Break the given phase into a 4-step mini-roadmap.

You MUST respond with ONLY valid JSON. Start directly with { — no markdown, no backticks, no preamble.

{"steps":[{"title":"Step name","timeline":"e.g. Days 1-3","description":"2 sentences describing what to do and why.","actions":["Specific action 1","Specific action 2","Specific action 3"]}]}

Create exactly 4 steps. Each step must have title, timeline, description, and 2-3 actions. Be specific and actionable.`
      : `You are Paso, an AI roadmap generator. Convert the given phase into a detailed daily schedule for 2 weeks.

You MUST respond with ONLY valid JSON. Start directly with { — no markdown, no backticks, no preamble.

{"weeks":[{"week":1,"days":[{"day":"Monday","tasks":["Specific task 1","Specific task 2"]}]}]}

Create exactly 2 weeks. Each week has 5-7 days. Each day has 2-3 specific tasks. Be practical and actionable.`;

    return {
      system,
      user: `Goal: ${goal}\nPhase: ${phase.title} (${phase.weeks})\nDescription: ${phase.description}\nMilestones: ${phase.milestones.join("; ")}\nActions: ${phase.actions.join("; ")}`,
      maxTokens: 3072,
    };
  },

  adjust: (goal, roadmapJson, adjustInput, completedMilestones) => ({
    system: `You are Paso, an AI roadmap generator by Numina Labs. The user has an existing roadmap for "${goal}" and wants to adjust it.

IMPORTANT: First, check if the user's update is actually an adjustment to their existing goal "${goal}" or if they're asking for something completely unrelated (a new goal entirely). If it's a completely new, unrelated goal, respond with exactly: {"error": "NEW_GOAL", "message": "This sounds like a new goal rather than an adjustment. Use 'Set your next goal' instead."}

CRITICAL: The user has already completed these milestones — you MUST keep them in the same phases, in the same order, unchanged:
${completedMilestones.map((m, i) => `${i + 1}. "${m}"`).join("\n")}

If it IS a valid adjustment, return the FULL updated roadmap JSON in the exact same structure (phases array with title, tagline, milestones, actions, sideQuest, researchNote, researchSource, closingQuote, closingQuoteAuthor). Keep ALL completed milestones exactly as they are. Adapt the remaining unchecked milestones and add/remove phases as needed. Include a new closingQuote relevant to the adjusted plan.`,
    user: `Current roadmap:\n${JSON.stringify(roadmapJson)}\n\nUser's update: ${adjustInput}`,
    maxTokens: 6000,
  }),
};

// ─── INPUT SANITIZATION ───

function sanitize(str, maxLen = 2000) {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

// ─── HANDLER ───

export async function POST(request) {
  // Block unauthorized origins + enforce rate limit (4/min, 20/hour per IP)
  const guard = apiGuard(request, "generate");
  if (guard.blocked) return guard.response;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    let prompt;

    switch (action) {
      case "questions": {
        const goal = sanitize(body.goal, 500);
        if (!goal) return NextResponse.json({ error: "Missing goal" }, { status: 400 });
        prompt = PROMPTS.questions(goal);
        break;
      }

      case "roadmap": {
        const goal = sanitize(body.goal, 500);
        const answers = body.answers || [];
        const extras = body.extras || {};
        const context = answers.map((a) => {
          const val = Array.isArray(a.answer) ? a.answer.join(", ") : a.answer;
          const extra = extras[a.id] ? ` (additional context: ${sanitize(extras[a.id], 500)})` : "";
          return `${sanitize(a.question, 200)}: ${sanitize(val, 500)}${extra}`;
        }).join("\n");
        if (!goal) return NextResponse.json({ error: "Missing goal" }, { status: 400 });
        prompt = PROMPTS.roadmap(goal, context);
        break;
      }

      case "breakdown": {
        const goal = sanitize(body.goal, 500);
        const phase = body.phase;
        const mode = body.mode === "daily" ? "daily" : "mini";
        if (!goal || !phase) return NextResponse.json({ error: "Missing goal or phase" }, { status: 400 });
        prompt = PROMPTS.breakdown(goal, phase, mode);
        break;
      }

      case "adjust": {
        const goal = sanitize(body.goal, 500);
        const adjustInput = sanitize(body.adjustInput, 1000);
        const roadmapJson = body.roadmap;
        const completedMilestones = body.completedMilestones || [];
        if (!goal || !adjustInput) return NextResponse.json({ error: "Missing goal or adjustInput" }, { status: 400 });
        prompt = PROMPTS.adjust(goal, roadmapJson, adjustInput, completedMilestones);
        break;
      }

      // Legacy: raw system/userMsg (for backwards compat during migration)
      case "raw": {
        prompt = {
          system: sanitize(body.system, 4000),
          user: sanitize(body.userMsg, 12000),
          maxTokens: body.maxTokens || 1024,
        };
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: prompt.maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("Generate API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}