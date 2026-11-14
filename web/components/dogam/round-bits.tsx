"use client";
// 세 판 게임의 작은 판들(hh 2026-11-08): 정찰원 꽃잎 짚기, 암호해독관 기록 맞추기.
// 꽃잎 짚기는 세기를 돕는 표시일 뿐 판정하지 않는다(답은 서버가 확인). 기록 맞추기의 글은 서버 해설에서 온다.
import { type PointerEvent, useMemo, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { play } from "@/lib/sound";
import { recordTiles, shuffledOrder } from "@/lib/field-rounds";
import { PANORAMA, Panorama } from "./dogam-art";
import { buzz } from "./use-field-sense";
import s from "./dogam.module.css";

/** 찍은 사진(그림이면 당겨 본 조형물 그림) 위를 눌러 꽃잎마다 번호 표시를 붙인다. */
export function PetalCount({ photo, alt }: { photo: string | null; alt: string }) {
  const [marks, setMarks] = useState<{ x: number; y: number }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const mark = (e: PointerEvent) => {
    const rc = box.current?.getBoundingClientRect();
    if (!rc || marks.length >= 9) return;
    setMarks([...marks, { x: (e.clientX - rc.left) / rc.width * 100, y: (e.clientY - rc.top) / rc.height * 100 }]);
    play("dial-tick"); buzz(12);
  };
  const { target } = PANORAMA;
  return <div className={s.petals}>
    <div ref={box} className={s.petalBox} onPointerDown={mark} data-testid="field-petals" role="img" aria-label={alt}>
      {photo ? <img src={photo} alt="" draggable={false} />
        : <svg viewBox={`${target.x - 50} ${target.y - 42} 100 84`} aria-hidden="true" focusable="false"><Panorama /></svg>}
      {marks.map((m, i) => <span key={i} className={s.petalMark} style={{ left: `${m.x}%`, top: `${m.y}%` }}>{i + 1}</span>)}
    </div>
    <div className={s.petalBar}>
      <span role="status">{marks.length ? `${marks.length}개 짚었어요` : "꽃잎을 하나씩 눌러 짚어요"}</span>
      {!!marks.length && <button type="button" className={s.linkBtn} onClick={() => setMarks([])}><RotateCcw size={15} aria-hidden /> 다시 세기</button>}
    </div>
  </div>;
}

/** 흩어진 낱말 조각을 차례대로 눌러 기록 한 줄을 맞춘다. 다 놓으면 맞는 앞부분만 남기고 나머지는 돌아온다. */
export function RecordTiles({ text, onDone, reduce, seed = 7 }: { text: string; onDone: () => void; reduce: boolean; seed?: number }) {
  const tiles = useMemo(() => recordTiles(text), [text]);
  const order = useMemo(() => shuffledOrder(tiles.length, seed), [tiles.length, seed]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [locked, setLocked] = useState(0);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState("");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  if (!tiles.length) return <div className={s.tiles}>
    <p className={s.say}>기록실 쪽지가 아직 오지 않았어요.</p>
    <button type="button" className={`${s.btn} ${s.roleBtn}`} onClick={onDone}>다음으로</button>
  </div>;

  const put = (i: number) => {
    if (done || placed.includes(i)) return;
    const next = [...placed, i];
    setPlaced(next); play("dial-tick");
    if (next.length < tiles.length) return;
    const wrongAt = next.findIndex((t, p) => tiles[t] !== tiles[p]);
    if (wrongAt < 0) {
      setDone(true); setLocked(tiles.length); setNote("");
      play("stop-open"); buzz([20, 40, 20]);
      window.setTimeout(() => onDoneRef.current(), reduce ? 150 : 1400);
      return;
    }
    // 맞는 앞부분은 붙잡아 두고(색이 바뀐다), 나머지는 돌아온다
    setLocked(wrongAt); setShake((n) => n + 1); buzz(60);
    setNote(wrongAt ? `앞 ${wrongAt}조각은 맞아요. 나머지 차례를 다시 맞춰요.` : "첫 조각부터 다시 맞춰요.");
    window.setTimeout(() => setPlaced(next.slice(0, wrongAt)), reduce ? 0 : 420);
  };
  const take = (p: number) => { if (!done && p >= locked) setPlaced(placed.filter((_, q) => q !== p)); };

  return <div className={s.tiles} data-testid="field-tiles" data-done={done || undefined}>
    <div className={s.tileLine} data-shake={shake ? shake % 2 : undefined} aria-label="맞춘 기록">
      {tiles.map((_, p) => {
        const t = placed[p];
        return t == null ? <span key={p} className={s.tileSlot} aria-hidden />
          : <button key={p} type="button" className={s.tile} data-locked={p < locked || undefined} onClick={() => take(p)}
            aria-label={`${tiles[t]}${p < locked ? ", 맞음" : ", 눌러서 빼기"}`}>{tiles[t]}</button>;
      })}
    </div>
    {done ? <p className={s.record}><Check size={16} aria-hidden /> {tiles.join(" ")}</p>
      : <div className={s.tilePool} role="group" aria-label="흩어진 조각">
        {order.map((i) => <button key={i} type="button" className={s.tile} disabled={placed.includes(i)} onClick={() => put(i)}
          data-testid="field-tile" data-i={i}>{tiles[i]}</button>)}
      </div>}
    {note && !done && <p className={s.wrongNote} role="status">{note}</p>}
  </div>;
}
