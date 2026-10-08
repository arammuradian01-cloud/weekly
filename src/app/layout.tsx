import type { Metadata, Viewport } from "next";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource-variable/golos-text";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/register";

export const metadata: Metadata = {
  title: { default: "Weekly", template: "%s | Weekly" },
  description: "Weekly и задачи команды «Страхование и инвестиции»",
  robots: { index: false, follow: false },
  // Приложение на экране «Домой» (этап 26): значок для iPhone и запуск без адресной строки
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Weekly", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#002a3a" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1419" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Тема (этап 18): светлая, тёмная или как в системе. Выбор лежит в cookie theme на этом устройстве, атрибут data-theme
 * ставится на html до первой отрисовки, чтобы страница не мигала. «Как в системе» следит за prefers-color-scheme
 */
const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=(light|dark|system)/);var t=m?m[1]:"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");document.documentElement.setAttribute("data-theme-choice",t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
