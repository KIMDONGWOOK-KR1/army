import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./game-theme.css";
import localFont from "next/font/local";
const gameFont = localFont({ src: "../public/fonts/Jua-Regular.ttf", variable: "--font-game", weight: "400", display: "swap", preload: false });
import { mockupBootScript } from "@/components/mockup-view";
export const metadata: Metadata = {
  title: "호국실록 — 기억을 잇는 전남대편",
  description:
    "네 사람이 서로 다른 현장의 단서를 나누고 하나의 기억을 완성하는 협동 역사 교육 웹앱.",
  robots: { index: false, follow: false },
  // 홈 화면에 추가해 열면 브라우저 막대 없이 연다. 상태 막대는 짙은 머리줄 위에 겹치고(머리줄이 안전 영역만큼 내려간다)
  appleWebApp: { capable: true, title: "호국실록", statusBarStyle: "black-translucent" },
  // 예전 iOS(16.3 이하)는 manifest 대신 이 표시를 보고 홈 화면 앱을 막대 없이 연다
  other: { "apple-mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 아이폰 노치·아래 막대 영역까지 그리고, 글자·버튼은 env(safe-area-inset-*)로 비켜 둔다
  viewportFit: "cover",
  themeColor: "#213c2c",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    // 목업으로 열 때 인라인 스크립트가 수화 전에 data-mockup을 단다(그 차이는 경고하지 않는다)
    <html lang="ko" className={gameFont.variable} suppressHydrationWarning>
      <body>
        {/* 폰 목업 보기로 열지 첫 그림 전에 정한다(목업일 때만 서버가 그린 앱을 감춘다. app-shell.tsx) */}
        <script dangerouslySetInnerHTML={{ __html: mockupBootScript() }} />
        <a href="#main-content" className="skip-link">
          본문으로 건너뛰기
        </a>
        {children}
      </body>
    </html>
  );
}
