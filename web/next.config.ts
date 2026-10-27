import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // 같은 와이파이의 폰에서 개발 서버를 열어 시험할 수 있게 사설 LAN 주소를 허용한다.
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          // 다른 사이트의 틀에는 담기지 않게 막고, 폰 목업 보기(같은 출처 iframe)만 허용한다
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      // 정찰원 사진 미션 개발용 미리보기와 게임 화면의 '사진으로 찾기'(모의 판정)만 카메라를 허용한다
      // (같은 키는 뒤 규칙이 이긴다). 판정 서버와 잇기 전이라 운영 빌드에는 넣지 않는다. 게임 화면은 위치(GPS)도 그대로 둔다.
      ...(process.env.NODE_ENV === "production" ? [] : [{
        source: "/dev/scout-photo",
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }],
      }, ...["/", "/j/:code"].map((source) => ({
        source,
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" }],
      }))]),
    ];
  },
};
export default config;
