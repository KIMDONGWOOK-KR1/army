"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import { loadFieldAssets, type FieldAssets } from "./field-assets";
import {
  acquireCore,
  disposeTree,
  releaseCore,
  SKY,
  type Core,
} from "./field-3d";
import type { MapData } from "./field-map";
import { resetSeeThrough } from "./field-occlusion";
import { AdaptiveQuality, fieldFlags } from "./field-perf";
import {
  bandOffset,
  HOME,
  heroDistance,
  homeCamera,
  roadAxis,
  soldierSpots,
} from "./home-view";
import { crewSoldier } from "./soldier-props";
import { HOME_VARIANTS } from "./soldier-variants";
import jnu from "./maps/jnu.json";
import { ROLES } from "@/supabase/functions/_shared/types";

// 첫 화면(타이틀) 뒤에 까는 입체 배경: 이동 화면과 같은 점토 캠퍼스(field-map)를 같은 렌더러로
// 빌려 쓰고(field-3d의 core), 정문 앞에 네 보직 장병(C02)을 세워 천천히 도는 카메라로 비춘다.
// 모형을 받는 동안과 WebGL·모형을 쓸 수 없을 때는 fallback(평면 그림)을 그대로 보여 준다.
// 버튼은 이 배경과 상관없이 바로 눌린다(캔버스는 눌림을 받지 않는다).
//
// 화면 띠: 같은 장면(.game-scene) 안의 [data-hero-top] 아래 끝과 [data-hero-bottom] 위 끝 사이에
// 장병을 둔다(제목과 아래 버튼판에 가리지 않게).

const MAP = jnu as unknown as MapData,
  ANCHORS = MAP.anchors;
const xz = (p: [number, number]) => ({ x: p[0], z: p[1] });

type HomeStats = {
  calls: number;
  triangles: number;
  shadowCalls: number;
  shadowTriangles: number;
  geometries: number;
  textures: number;
  programs: number;
  pixelRatio: number;
  shadowSize: number;
  buildMs: number;
  frames: number;
};
declare global {
  interface Window {
    __homeStats?: HomeStats;
  }
}

export function HomeHero({ fallback }: { fallback: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const credit = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // WebGL 문맥을 잃었다 되찾으면 올려 새 렌더러로 다시 띄운다
  const [epoch, setEpoch] = useState(0);
  const [assets, setAssets] = useState<FieldAssets | null>(null);

  useEffect(() => {
    let gone = false;
    loadFieldAssets().then((a) => {
      if (gone) return;
      // 정문·장병 모형이 없으면 이 화면은 평면 그림으로 둔다
      if (!a.gate || !a.soldier) setFailed(true);
      else setAssets(a);
    });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !assets?.soldier) return;
    let alive = true;
    let frame = 0;
    let idle = 0;
    const cleanups: (() => void)[] = [];

    // 지도 굽기는 무거운 한 덩어리 작업이라, 첫 화면이 뜨고 손가락이 먼저 닿을 틈을 준 뒤에 한다
    const start = () => {
      if (!alive) return;
      const t0 = performance.now();
      let core: Core;
      try {
        core = acquireCore(assets);
      } catch {
        setFailed(true);
        return;
      }
      const buildMs = performance.now() - t0;
      const { renderer, scene, sky, world, light, phone } = core;
      core.onRestore = () => setEpoch((n) => n + 1);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const dpr = window.devicePixelRatio || 1,
        top = phone ? 512 : 1024;
      // 배경이라 픽셀 비율은 1.25까지, 그림자는 작게. 느리면 픽셀 비율 → 그림자 순으로 낮춘다.
      const quality = new AdaptiveQuality(
        [
          { pixelRatio: Math.min(dpr, HOME.pixelRatio), shadow: top },
          { pixelRatio: Math.min(dpr, 1), shadow: 512 },
          { pixelRatio: Math.min(dpr, 1), shadow: 0 },
        ],
        fieldFlags(window.location.search).pinned,
      );
      const apply = () => {
        renderer.setPixelRatio(quality.current.pixelRatio);
        light.setShadowSize(quality.current.shadow);
      };
      apply();
      light.invalidate();
      resetSeeThrough();

      // 이번 화면에서만 쓰는 것(장병)은 한 묶음에 넣어 닫을 때 한꺼번에 빼고 지운다
      const mount = new THREE.Group();
      mount.name = "home-mount";
      scene.add(mount);
      const gate = xz(ANCHORS.gate),
        axis = roadAxis(gate, ANCHORS.tower ? xz(ANCHORS.tower) : { x: 0, z: -1 }),
        spots = soldierSpots(gate, axis, ROLES.length);
      const crew = ROLES.map((role, i) => {
        // 보직 소품(깃발·쌍안경·무전기·열쇠)과 사람마다 다른 모습(피부색·키·안경·서기 동작 어긋남)
        const hero = crewSoldier(assets.soldier!, {
          height: HOME.soldierM,
          role,
          variant: HOME_VARIANTS[role],
        });
        // 화면 왼쪽부터 지휘관·정찰원·통신원·암호해독관 차례로 선다
        const s = spots[spots.length - 1 - i];
        hero.group.position.set(s.x, 0.36, s.z);
        hero.group.rotation.y = s.ry;
        // 발밑 고리는 작게 줄여 보직 색만 알아보게 한다
        hero.group.children[1].scale.setScalar(0.62);
        mount.add(hero.group);
        return { hero };
      });
      // 장병 무리 가운데(바라볼 곳)와 정면에서 카메라 쪽(바깥) 방향
      const focus = new THREE.Vector3(
        spots.reduce((a, s) => a + s.x, 0) / spots.length,
        0,
        spots.reduce((a, s) => a + s.z, 0) / spots.length,
      );
      const aim = focus.clone().setY(HOME.soldierM * HOME.aim);
      const outward = Math.atan2(-axis.x, -axis.z);

      const camera = new THREE.PerspectiveCamera(40, 1, 1, SKY.radius + 20);
      // 그림자 상자는 기준 카메라 자리에 묶어 카메라가 돌아도 그림자 지도를 자꾸 다시 그리지 않는다
      const anchorCam = new THREE.Object3D();
      let dist = 40;
      const place = (cam: THREE.Object3D, az: number, d: number, el: number) => {
        const a = outward + az;
        cam.position.set(
          aim.x + Math.sin(a) * Math.cos(el) * d,
          aim.y + Math.sin(el) * d,
          aim.z + Math.cos(a) * Math.cos(el) * d,
        );
      };
      const resize = () => {
        const w = el.clientWidth || 1,
          h = el.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.fov = w / h < 0.8 ? 50 : 34;
        // 제목 아래 끝과 버튼판 위 끝 사이(화면 띠)에 장병을 둔다
        const r = el.getBoundingClientRect(),
          stage = el.closest(".game-scene"),
          topEl = stage?.querySelector("[data-hero-top]"),
          botEl = stage?.querySelector("[data-hero-bottom]");
        const bandTop = topEl ? topEl.getBoundingClientRect().bottom - r.top : h * 0.3,
          bandBot = botEl ? botEl.getBoundingClientRect().top - r.top : h * 0.8;
        dist = heroDistance(h, bandBot - bandTop, camera.fov);
        camera.setViewOffset(w, h, 0, bandOffset(h, bandTop, bandBot), w, h);
        camera.updateProjectionMatrix();
        // 지도 출처(ODbL)는 버튼판 바로 위 오른쪽에 둔다
        if (credit.current)
          credit.current.style.top = `${Math.max(0, bandBot - 18)}px`;
        place(anchorCam, 0, dist, HOME.elevation);
        light.invalidate();
        if (reduced) draw(performance.now());
      };

      const stats: HomeStats | null =
        process.env.NODE_ENV !== "production" &&
        fieldFlags(window.location.search).dev
          ? {
              calls: 0,
              triangles: 0,
              shadowCalls: 0,
              shadowTriangles: 0,
              geometries: 0,
              textures: 0,
              programs: 0,
              pixelRatio: 0,
              shadowSize: 0,
              buildMs,
              frames: 0,
            }
          : null;
      if (stats) window.__homeStats = stats;

      let began = -1,
        last = -1,
        shown = false;
      const draw = (t: number) => {
        if (began < 0) began = t;
        const frameMs = last < 0 ? 0 : t - last,
          dt = Math.min(0.1, frameMs / 1000),
          sec = (t - began) / 1000;
        last = t;
        const cam = homeCamera(sec, reduced);
        place(camera, cam.az, dist * cam.distK, cam.elevation);
        camera.lookAt(aim);
        sky.position.copy(camera.position);
        const fog = scene.fog as THREE.Fog,
          d = camera.position.distanceTo(aim);
        fog.near = d + HOME.fog.near;
        fog.far = Math.max(fog.near + 60, HOME.fog.far);
        if (!reduced) for (const m of crew) m.hero.animate(dt, false, 0);
        camera.updateMatrixWorld();
        world.update(focus.x, focus.z, camera);
        anchorCam.updateMatrixWorld();
        const shadowFrame = light.follow(focus, anchorCam as THREE.Camera, false);
        // 30fps로 그리므로 한 장 시간을 60fps 기준으로 줄여 적응 화질에 넣는다
        if (!reduced && quality.tick(frameMs * (HOME.fps / 60))) apply();
        renderer.render(scene, camera);
        if (stats) {
          const r = renderer.info.render;
          if (shadowFrame) {
            stats.shadowCalls = Math.max(0, r.calls - stats.calls);
            stats.shadowTriangles = Math.max(0, r.triangles - stats.triangles);
          } else {
            stats.calls = r.calls;
            stats.triangles = r.triangles;
          }
          stats.geometries = renderer.info.memory.geometries;
          stats.textures = renderer.info.memory.textures;
          stats.programs = renderer.info.programs?.length ?? 0;
          stats.pixelRatio = renderer.getPixelRatio();
          stats.shadowSize = light.shadowSize;
          stats.frames++;
        }
        if (!shown) {
          shown = true;
          setReady(true);
        }
      };

      // 초당 30장. 탭이 숨으면 멈추고, 움직임 줄이기 설정이면 카메라를 세우고 가끔만 그린다.
      const step = 1000 / HOME.fps - 2;
      let prev = -Infinity;
      const loop = (t: number) => {
        frame = 0;
        if (!alive || document.hidden || core.lost) return;
        frame = requestAnimationFrame(loop);
        if (t - prev < (reduced ? 500 : step)) return;
        prev = t;
        draw(t);
      };
      const wake = () => {
        if (!alive || document.hidden || frame) return;
        last = -1; // 숨어 있던 시간만큼 건너뛰지 않는다
        frame = requestAnimationFrame(loop);
      };
      document.addEventListener("visibilitychange", wake);

      el.prepend(renderer.domElement);
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      const band = el
        .closest(".game-scene")
        ?.querySelectorAll("[data-hero-top], [data-hero-bottom]");
      band?.forEach((b) => ro.observe(b));
      resize();
      // 셰이더는 그리기 전에 나눠 컴파일해(가능한 기기에서는 비동기로) 첫 장면에서 멈칫하지 않게 한다
      place(camera, 0, dist, HOME.elevation);
      camera.lookAt(aim);
      renderer
        .compileAsync(scene, camera)
        .catch(() => undefined)
        .then(() => {
          if (alive) wake();
        });

      cleanups.push(() => {
        cancelAnimationFrame(frame);
        frame = 0;
        document.removeEventListener("visibilitychange", wake);
        ro.disconnect();
        if (stats && window.__homeStats === stats) delete window.__homeStats;
        // 장병(역할 색 재질·뼈대)은 지금 지우고, 지도·렌더러는 이동 화면이 다시 쓰도록 맡긴다
        // (이동 화면이 KEEP_MS 안에 열리지 않으면 field-3d가 모두 지운다)
        scene.remove(mount);
        disposeTree(mount);
        renderer.domElement.remove();
        core.onRestore = null;
        releaseCore(core);
      });
    };

    // 첫 화면이 그려지고 숨 돌린 뒤에 굽는다(되는 브라우저는 한가할 때, 아니면 잠시 뒤).
    // 방금 화면을 눌렀으면(버튼을 누르는 중일 수 있다) 조금 더 미뤄 누름이 먼저 처리되게 한다.
    let touched = -Infinity,
      timer: ReturnType<typeof setTimeout> | undefined;
    const onTouch = () => {
      touched = performance.now();
    };
    document.addEventListener("pointerdown", onTouch, true);
    const schedule = () => {
      const go = () => {
        if (performance.now() - touched < 1200) timer = setTimeout(schedule, 600);
        else start();
      };
      if ("requestIdleCallback" in window)
        idle = window.requestIdleCallback(go, { timeout: 700 });
      else timer = setTimeout(go, 200);
    };
    schedule();
    cleanups.push(() => {
      document.removeEventListener("pointerdown", onTouch, true);
      if (idle) window.cancelIdleCallback(idle);
      clearTimeout(timer);
    });
    return () => {
      alive = false;
      for (const f of cleanups.reverse()) f();
    };
  }, [assets, epoch]);

  if (failed) return <>{fallback}</>;
  return (
    <div className={`home-hero ${ready ? "ready" : ""}`}>
      <div className="home-hero-poster" aria-hidden={ready}>
        {fallback}
      </div>
      <div
        ref={host}
        className="home-hero-3d"
        role="img"
        aria-label="전남대 정문 앞에 네 보직 장병이 조용히 서 있고, 카메라가 민주대로 쪽을 천천히 비추는 입체 캠퍼스"
        aria-hidden={!ready}
      />
      <span ref={credit} className="home-hero-credit">{MAP.credit}</span>
    </div>
  );
}
