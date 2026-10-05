import type { Metadata, Viewport } from "next";
import "@fontsource-variable/golos-text";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Weekly", template: "%s | Weekly" },
  description: "Weekly и задачи команды «Страхование и инвестиции»",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#002a3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
