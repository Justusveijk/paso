// app/api/manifest/route.js
// Serves a dynamic manifest.json — iOS Safari fetches this at "Add to Home Screen" time.
// The roadmap ID is passed as a query param: /api/manifest?r=abc123

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("r");
  // Sanitize: only allow lowercase alphanumeric, max 20 chars
  const roadmapId = raw && /^[a-z0-9]{1,20}$/.test(raw) ? raw : null;

  const manifest = {
    name: "Paso - Your Roadmap to Any Goal",
    short_name: "Paso",
    description: "AI-powered goal roadmaps. Step by step. Starting now.",
    start_url: roadmapId ? `/?r=${roadmapId}` : "/",
    id: "paso",
    display: "standalone",
    background_color: "#f8f5ff",
    theme_color: "#6C5CE7",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-48.png", sizes: "48x48", type: "image/png" },
      { src: "/icon-96.png", sizes: "96x96", type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
