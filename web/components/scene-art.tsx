"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BrandBackdrop, LoadingSplash } from "./loading-splash";

/** 전환 중에는 기존 브랜드 로딩을 화면 전체에 표시한다. 준비된 장면이 마운트되면 함께 사라진다. */
export function SceneArt({ loading = false }: {
  site?: number; night?: boolean; party?: boolean; loading?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return <>
    <div className="scene-art" data-testid="brand-scene" aria-hidden="true" style={{ pointerEvents: "none" }}><BrandBackdrop /></div>
    {loading && mounted && createPortal(
      <div data-testid="brand-transition" style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
        <LoadingSplash done={false} />
      </div>, document.body)}
  </>;
}
