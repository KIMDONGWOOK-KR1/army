import type { Metadata, Viewport } from "next";
import "@fontsource/bagel-fat-one/400.css";
import "./globals.css";
import { mockupBootScript } from "@/components/mockup-view";
export const metadata: Metadata = {
  title: "호국실록 — 기억을 잇는 전남대편",
  description:
    "네 사람이 서로 다른 현장의 단서를 나누고 하나의 기억을 완성하는 협동 역사 교육 웹앱.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#213c2c",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    // 목업으로 열 때 인라인 스크립트가 수화 전에 data-mockup을 단다(그 차이는 경고하지 않는다)
    <html lang="ko" suppressHydrationWarning>
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
