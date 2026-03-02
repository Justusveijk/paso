import "./globals.css";

export const metadata = {
  title: "Callis — AI-Powered Roadmaps | by Numina Labs",
  description: "Tell Callis your goal. Get a personalized roadmap with checkable milestones, scientific references, and side quests.",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon.png",
  },
  openGraph: {
    title: "Callis — Every ambition deserves a path.",
    description: "AI-powered roadmaps backed by research. Personalized phases, milestones, and scientific insights.",
    type: "website",
    siteName: "Callis by Numina Labs",
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