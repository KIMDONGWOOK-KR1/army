"use client";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  bgmLevelForScene,
  installSoundListeners,
  isSoundName,
  moodForScene,
  play,
  playCue,
  setBgmLevel,
  setFileLevel,
  setMemorialState,
  setSceneQuiet,
  startBgm,
} from "@/lib/sound";
import { trackForScene } from "@/lib/sound-files";
import { judgeCue } from "@/lib/judge-cue";
import type { Command, Snapshot } from "@/supabase/functions/_shared/types";

// 이동 장면에서 이 장면들로 넘어가는 순간이 거점 도착이다(game-app과 같은 목록)
const ARRIVAL = ["mission", "report", "lock", "waiting"];

// 서버 판정이 돌아온 순간의 소리(무슨 소리를 낼지는 lib/judge-cue.ts가 정한다).
// send를 감싸기만 하므로 미션·자물쇠 화면을 고치지 않아도 된다.
export function useCueSend<S extends Snapshot>(send: (c: Command) => Promise<S | null>) {
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
  silent = false,
  epilogue = false,
  final = false,
  wall = false,
  narration,
  reportKey,
  reported,
  digits,
}: {
  scene: string;
  reverent: boolean;
  // 이동 중 5·18 조용한 구역 안(배경음을 추모 숨결로 낮춘다)
  hushed?: boolean;
  silent?: boolean;
  // 봉지(회고) 단계인가 — 08
  epilogue?: boolean;
  // 최종 결과 화면인가 — 09 한 번, 그 뒤로 곡 없음
  final?: boolean;
  // 추모의 벽 단계인가(사초 소리 1/3)
  wall?: boolean;
  narration: boolean;
  // 같은 거점·보직인지 가리는 열쇠(보고가 막 끝났을 때만 숫자 획득 소리를 낸다)
  reportKey: string;
  reported: boolean;
  digits: string[];
}) {
  useLayoutEffect(() => { setSceneQuiet(silent); }, [silent]);
  useEffect(() => () => setSceneQuiet(false), []);
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
  // 음원 파일 반복 곡(01·03·04·05·08). 못 불러오면 엔진이 mood의 합성 배경음으로 대신한다
  const track = trackForScene({ scene, reverent, hushed, epilogue, final });
  useEffect(() => startBgm(final ? null : mood, track), [mood, track, final]);
  const level = bgmLevelForScene(scene, narration, mood);
  useEffect(() => setBgmLevel(level), [level]);
  useEffect(() => setFileLevel(narration ? 0.5 : 1), [narration]);
  // 묵념(06 한 번, 05의 새소리를 내린다)과 추모의 벽(사초 소리 1/3)
  const bowing = scene === "memorial";
  useEffect(() => setMemorialState({ wall, bowing }), [wall, bowing]);
  useEffect(() => () => setMemorialState({ wall: false, bowing: false }), []);
  // 최종 결과: 09를 한 번(끝나도 다른 곡을 붙이지 않는다)
  const wasFinal = useRef(final);
  useEffect(() => {
    if (final && !wasFinal.current) playCue("09");
    wasFinal.current = final;
  }, [final]);
  useEffect(() => () => startBgm(null), []);

  const lastScene = useRef(scene);
  useEffect(() => {
    const from = lastScene.current;
    lastScene.current = scene;
    if (from === scene) return;
    if (from === "travel" && ARRIVAL.includes(scene))
      play("arrive", { calm: reverent });
    // 자물쇠가 열려 사초를 되찾는 순간(마지막 거점은 곧바로 완료 화면). 열림 소리가 끝난 뒤 울린다.
    // 최종 결과로 넘어갈 때는 사초 소리 대신 09만 낸다
    else if ((scene === "sacho" || scene === "done") && ARRIVAL.includes(from) && !final)
      play("sacho", { delay: 1.1 });
  }, [scene, reverent, final]);

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
