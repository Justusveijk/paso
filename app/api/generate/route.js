export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    console.log("Got request:", Object.keys(body));
    
    const { system, userMsg, maxTokens = 1024 } = body;

    if (!system || !userMsg) {
      return new Response(JSON.stringify({ error: "Missing system or userMsg" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log("API key exists:", !!apiKey, "starts with:", apiKey?.substring(0, 10));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    console.log("Anthropic status:", res.status);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.log("Anthropic error:", errData);
      return new Response(JSON.stringify({ error: errData?.error?.message || `API error: ${res.status}` }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("CRASH:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}