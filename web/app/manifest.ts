import type { MetadataRoute } from "next";

// 폰 '홈 화면에 추가'로 열면 사파리 위아래 막대 없이 앱처럼 연다(hh 2026-10-29: 웹이라 위아래 고정 막대가 화면을 줄인다)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "호국실록 — 기억을 잇는 전남대편",
    short_name: "호국실록",
    description: "네 사람이 서로 다른 현장의 단서를 나누고 하나의 기억을 완성하는 협동 역사 교육 웹앱.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#dce9cb",
    theme_color: "#213c2c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
