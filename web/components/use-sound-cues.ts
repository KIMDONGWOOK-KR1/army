"use client";
import { useCallback, useEffect, useRef } from "react";
import {
  bgmLevelForScene,
  installSoundListeners,
  isSoundName,
  moodForScene,
  play,
  setBgmLevel,
  startBgm,
} from "@/lib/sound";
import { judgeCue } from "@/lib/judge-cue";
import type { Command, Snapshot } from "@/supabase/functions/_shared/types";

// 이동 장면에서 이 장면들로 넘어가는 순간이 거점 도착이다(game-app과 같은 목록)
const ARRIVAL = ["mission", "report", "lock", "waiting"];

// 서버 판정이 돌아온 순간의 소리(무슨 소리를 낼지는 lib/judge-cue.ts가 정한다).
// send를 감싸기만 하므로 미션·자물쇠 화면을 고치지 않아도 된다.
export function useCueSend(send: (c: Command) => Promise<Snapshot | null>) {
  return useCallback(
    async (c: Command) => {
      const next = await send(c);
      const cue = judgeCue(c, next);
      if (cue) play(cue.name, { calm: cue.calm });
      return next;
    },
    [send],
  );
}

// 장면에 맞춘 배경음·도착·사초·숫자 획득·자물쇠 입력 소리, 그리고 화면 공통 버튼 탭 소리.
export function useSoundCues({
  scene,
  reverent,
  hushed = false,
  narration,
  reportKey,
  reported,
  digits,
}: {
  scene: string;
  reverent: boolean;
  // 이동 중 5·18 조용한 구역 안(배경음을 추모 숨결로 낮춘다)
  hushed?: boolean;
  narration: boolean;
  // 같은 거점·보직인지 가리는 열쇠(보고가 막 끝났을 때만 숫자 획득 소리를 낸다)
  reportKey: string;
  reported: boolean;
  digits: string[];
}) {
  useEffect(() => {
    const off = installSoundListeners();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(
        "button, [role='button']",
      );
      if (!el || el.matches(":disabled, [aria-disabled='true']")) return;
      const named = el.getAttribute("data-sound");
      if (named === "none") return;
      play(
        isSoundName(named)
          ? named
          : el.classList.contains("primary")
            ? "confirm"
            : "tap",
      );
    };
    document.addEventListener("click", onClick, true);
    return () => {
      off();
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  const mood = moodForScene(scene, reverent, hushed);
  useEffect(() => startBgm(mood), [mood]);
  const level = bgmLevelForScene(scene, narration, mood);
  useEffect(() => setBgmLevel(level), [level]);
  useEffect(() => () => startBgm(null), []);

  const lastScene = useRef(scene);
  useEffect(() => {
    const from = lastScene.current;
    lastScene.current = scene;
    if (from === scene) return;
    if (from === "travel" && ARRIVAL.includes(scene))
      play("arrive", { calm: reverent });
    // 자물쇠가 열려 사초를 되찾는 순간(마지막 거점은 곧바로 완료 화면). 열림 소리가 끝난 뒤 울린다.
    else if ((scene === "sacho" || scene === "done") && ARRIVAL.includes(from))
      play("sacho", { delay: 1.1 });
  }, [scene, reverent]);

  const report = useRef({ key: reportKey, reported });
  useEffect(() => {
    const was = report.current;
    report.current = { key: reportKey, reported };
    if (was.key === reportKey && !was.reported && reported)
      play("digit-reveal", { delay: 0.4 });
  }, [reportKey, reported]);

  const typed = digits.join(",");
  const lastTyped = useRef(digits);
  useEffect(() => {
    const was = lastTyped.current;
    lastTyped.current = digits;
    if (
      scene === "lock" &&
      digits.some((d, i) => d !== "" && d !== (was[i] ?? ""))
    )
      play("lock-tick");
  }, [typed]);
}
