"use client";
// 거점을 마친 뒤 사초 화면에 붙는 글: 가운데 큰 문장(거점마다 다름)과 '다음 거점' 카드.
import { MapPin } from "lucide-react";
import type { Site } from "@/supabase/functions/_shared/types";
import { plain } from "@/lib/practice-text";

/** 사초 화면 가운데 큰 문장. 정문 문장은 사초①(정문)에만 쓴다 */
const CLOSING: Record<string, [string, string]> = {
  gate: ["정문에서 시작된 그해 오월을", "네 사람의 자리에서 다시 이었다."],
  yongbong: ["흩어진 자료를 네 사람이 맞춰", "기록 한 장을 더 채웠다."],
  wall: ["용봉열사 추모의 벽 앞에서", "네 사람이 함께 고개를 숙였다."],
};
const CLOSING_BY_SEQ = ["gate", "yongbong", "wall"];

export function closingLines(site: Pick<Site, "id" | "seq">): [string, string] | null {
  return CLOSING[site.id] ?? CLOSING[CLOSING_BY_SEQ[site.seq - 1] ?? ""] ?? null;
}

/** "사초③ · 용봉열사 추모의 벽" */
export function sachoEyebrow(site: Pick<Site, "seq" | "name">) {
  return `사초${"①②③④⑤⑥"[site.seq - 1] ?? site.seq} · ${plain(site.name)}`;
}

/** 다음 거점까지 걸어서 가는 거리(지도 길찾기 다리 길이를 반올림)와 한 줄 소개 */
const NEXT: Record<string, { walk: string; note: string }> = {
  yongbong: { walk: "걸어서 약 390m", note: "네 사람이 각자 단서를 풀어 자물쇠를 여는 곳이에요." },
  wall: { walk: "걸어서 약 350m", note: "문제 없이 국화를 올리는 곳이에요. 가까워지면 음악이 자연음으로 바뀌어요." },
  bongji: { walk: "걸어서 약 180m", note: "네 사람이 오늘을 돌아보는 곳이에요." },
};

/** 부를 때 쓰는 짧은 이름: '용봉열사 추모의 벽' → '추모의 벽' */
export const shortName = (name: string) => plain(name).replace(/^용봉열사\s+/, "");

/** 받침 따라 '으로'/'로' */
export function toward(name: string) {
  const last = name.charCodeAt(name.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${name}(으)로`;
  const jong = (last - 0xac00) % 28;
  return `${name}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}

export function NextStopCard({ next }: { next: Pick<Site, "id" | "name"> }) {
  const info = NEXT[next.id];
  return (
    <div className="next-stop" data-testid="next-stop">
      <MapPin size={20} aria-hidden="true" />
      <div>
        {/* 거리('걸어서 약 350m')는 한 덩어리로 줄바꿈한다 */}
        <b>다음 · {plain(next.name)}{info && <> · <span className="nowrap">{info.walk}</span></>}</b>
        {info && <p>{info.note}</p>}
      </div>
    </div>
  );
}
