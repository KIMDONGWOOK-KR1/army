"use client";
import { useEffect, useState } from "react";

// 확정 B안 로딩 화면(pm-design/brand-v1, hh 2026-10-29): 앱이 처음 뜰 때 실제 준비(세션 복구·글꼴)가 끝날 때까지만 덮는다.
// 시작 단추·메뉴·'기록을 준비하고 있어요' 문구·최소 대기 시간은 두지 않는다. 진행률을 알 수 없어 막대는 불확정 대기 표시다.
// 서버도 같은 모습으로 그려 첫 그림부터 로고와 배경이 보이고, 준비되면 짧게 옅어지며(모션 감소면 바로) 사라진다.
export function LoadingSplash({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setGone(true), still ? 0 : 220);
    return () => window.clearTimeout(t);
  }, [done]);
  if (gone) return null;
  return (
    <div className="loading-splash" data-done={done} aria-hidden={done} data-testid="loading-splash">
      <div className="loading-halo" aria-hidden="true" />
      <i className="loading-leaf a" aria-hidden="true" />
      <i className="loading-leaf b" aria-hidden="true" />
      <i className="loading-leaf c" aria-hidden="true" />
      <div className="loading-logo">
        <img
          src="/brand/hoguk-logo-1200.webp"
          srcSet="/brand/hoguk-logo-720.webp 720w, /brand/hoguk-logo-1200.webp 1200w"
          sizes="(max-width: 480px) 90vw, 440px"
          width={1200}
          height={573}
          alt="호국실록"
          fetchPriority="high"
        />
        <p className="loading-edition">전남대편</p>
      </div>
      <div className="loading-bar" role="progressbar" aria-label="게임 준비 중" aria-valuetext="준비 중" />
      <p className="loading-footer">네 사람이 함께 만드는 기록</p>
      <div className="loading-recovery"><p>연결이 오래 걸리고 있어요.</p><a href="" className="button secondary">다시 연결하기</a></div>
      <img className="loading-campus" src="/brand/loading-hall.svg" alt="" aria-hidden="true" width={600} height={220} />
    </div>
  );
}

// 로딩 화면과 같은 바탕(연두→크림, 빛무리, 잎, 아래 용봉관). 호출명 화면처럼 메뉴 뒤 배경에도 쓴다(hh 2026-10-29)
export function BrandBackdrop() {
  return (
    <div className="brand-backdrop" aria-hidden="true">
      <div className="loading-halo" />
      <i className="loading-leaf a" />
      <i className="loading-leaf b" />
      <i className="loading-leaf c" />
      <img className="loading-campus" src="/brand/loading-hall.svg" alt="" width={600} height={220} />
    </div>
  );
}
