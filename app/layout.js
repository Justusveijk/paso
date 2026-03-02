import "./globals.css";

export const metadata = {
  title: "Paso — AI-Powered Roadmaps, One Step at a Time",
  description:
    "Tell Paso your goal. Get a personalized roadmap with checkable milestones, scientific references, and side quests.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_URL || "https://callis.vercel.app"),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Paso — Every ambition starts with a step.",
    description:
      "AI-powered roadmaps backed by research. Personalized phases, milestones, and scientific insights.",
    type: "website",
    siteName: "Paso by Numina Labs",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Paso — AI-Powered Roadmaps",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Paso — Every ambition starts with a step.",
    description:
      "AI-powered roadmaps backed by research. Personalized phases, milestones, and scientific insights.",
    images: ["/og.png"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}