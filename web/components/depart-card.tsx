"use client";
// 출발 연결 장면: 지휘관이 다음 거점으로 출발을 알리면, 기록 화면에서 지도로 넘어가는 사이에 한 번 띄운다.
// 방금 마친 장소와 다음 장소를 이어 주어 화면이 뚝 끊기지 않게 한다. 추모 장소로 갈 때는 차분한 글로.
import { useEffect, useRef } from "react";
import { BookOpen, Check, MapPin, Navigation } from "lucide-react";
import type { SiteInfo } from "@/supabase/functions/_shared/types";
import { plain } from "@/lib/practice-text";
import { nextStopInfo } from "./next-stop";

export function DepartCard({ from, to, byMe, stamps, total, onClose, onRecords }: {
  from: string; to: SiteInfo; byMe: boolean; stamps: number; total: number;
  onClose: () => void; onRecords: () => void;
}) {
  const info = nextStopInfo(to.id);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => { go.current?.focus({ preventScroll: true }); }, []);
  const calm = !!to.reverent;
  return (
    <div className="depart-card" data-calm={calm} role="dialog" aria-modal="true" aria-labelledby="depart-title" data-testid="depart-card">
      <div className="depart-card-body">
        <p className="depart-done"><span aria-hidden="true"><Check size={14} strokeWidth={3} /></span>{plain(from)} 기록 완성 · 기록첩 {stamps}/{total}</p>
        <p className="depart-who">{byMe ? "출발을 알렸어요. 함께 걸어가요." : "지휘관이 출발을 알렸어요."}</p>
        <h2 id="depart-title"><MapPin size={20} aria-hidden="true" /><span><small>다음 장소</small>{plain(to.name)}</span></h2>
        {info && <p className="depart-walk">{info.walk}</p>}
        <p className="depart-note">{calm ? "추모 공간으로 가요. 걸음을 늦추고 조용히 이동해요." : info?.note ?? "네 사람이 함께 걸어가요."}</p>
        <div className="depart-actions">
          <button ref={go} type="button" className="button primary" onClick={onClose}>지도에서 길 보기 <Navigation size={17} aria-hidden="true" /></button>
          <button type="button" className="button secondary" onClick={onRecords}>방금 기록 다시 읽기 <BookOpen size={17} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}
