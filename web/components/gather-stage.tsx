"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { Check } from "lucide-react";

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
  GATHER,
  gatherFlags,
  slotSpot,
  softwareRenderer,
  spawnPoint,
  turnToward,
  viewDistance,
  walkAt,
  type Walk,
} from "./gather-view";
import { bandOffset, HOME, roadAxis, soldierSpots } from "./home-view";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import { crewSoldier, warmProp, type CrewSoldier } from "./soldier-props";
import { soldierVariant } from "./soldier-variants";
import jnu from "./maps/jnu.json";
import { ROLE_NAMES, type Role } from "@/supabase/functions/_shared/types";

// 모이기(로비)·보직 공개·장비 장면 뒤에 까는 입체 배경. 첫 화면과 같은 점토 캠퍼스(field-3d의
// core)를 빌려 정문 앞 네 자리를 비추고, 동료가 합류할 때마다 장병이 정문 안쪽 길에서 걸어 나와
// 자리에 선다. 빈 자리는 점선 고리로 남긴다. 보직 공개 때는 서버가 정한 보직만 받아 소품을
// 튀어나오게 하고(여기서 보직을 고르지 않는다), 장비 장면에서는 내 장병을 가까이 비춘다.
// 호출명은 three 글자가 아니라 화면 위 글(DOM)로 머리 위에 띄운다.
//
// 화면 띠: .game-canvas 안의 [data-gather-top] 아래 끝과 [data-gather-bottom] 위 끝 사이에
// 장병을 둔다. WebGL·모형을 쓸 수 없으면 fallback(평면 그림) 위에 이름표를 칸으로 늘어놓는다.

const MAP = jnu as unknown as MapData,
  ANCHORS = MAP.anchors;
const xz = (p: [number, number]) => ({ x: p[0], z: p[1] });

export type GatherMember = {
  id: string;
  nickname: string;
  role: Role | null;
  ready: boolean;
  self: boolean;
};
// line: 네 사람이 줄 선 구도, self: 내 장병을 가까이
export type GatherShot = "line" | "self";
// 소품을 보이는 범위: 아직 없음, 나만(내 카드가 뒤집힌 순간), 모두
export type RevealStep = "none" | "self" | "all";

type GatherStats = {
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
  soldiers: number;
  rate: number; // 지금 초당 몇 장으로 그리는지(움직임 30, 다 서면 15)
};
declare global {
  interface Window {
    __gatherStats?: GatherStats;
  }
}

export const shownRole = (m: GatherMember, step: RevealStep) =>
  step === "all" || (step === "self" && m.self) ? m.role : null;

// 이 기기의 WebGL이 GPU 없이 CPU로 그리는지(한 번만 잰다). 잴 수 없으면 GPU로 본다.
let soft: boolean | null = null;
function softwareGL(): boolean {
  if (soft !== null) return soft;
  soft = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return soft;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    soft = softwareRenderer(
      String(
        gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "",
      ),
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  return soft;
}

export function GatherStage({
  members,
  shot,
  reveal,
  walkIn,
  hidden = false,
  fallback,
}: {
  members: GatherMember[]; // 합류한 차례
  shot: GatherShot;
  reveal: RevealStep;
  walkIn: boolean; // 새로 보이는 장병이 걸어 들어온다(로비). 아니면 제자리에 바로 선다.
  hidden?: boolean; // 위를 덮는 화면(나레이션)이 떠 있으면 그리지 않는다
  fallback: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tags = useRef<(HTMLLIElement | null)[]>([]);
  const credit = useRef<HTMLSpanElement>(null);
  const live = useRef({ members, shot, reveal, walkIn, hidden });
  live.current = { members, shot, reveal, walkIn, hidden };
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // WebGL 문맥을 잃었다 되찾으면 올려 새 렌더러로 다시 띄운다
  const [epoch, setEpoch] = useState(0);
  const [assets, setAssets] = useState<FieldAssets | null>(null);
  // 평면 그림일 때 이름표 칸을 둘 화면 띠(px)
  const [band, setBand] = useState<{ top: number; bottom: number } | null>(
    null,
  );

  useEffect(() => {
    let gone = false;
    // 소프트웨어 WebGL이면 처음부터 평면 그림(주소에 ?3d=1이면 그래도 입체)
    if (softwareGL() && !gatherFlags(window.location.search).force3d) {
      setFailed(true);
      return;
    }
    loadFieldAssets().then((a) => {
      if (gone) return;
      if (!a.gate || !a.soldier) setFailed(true);
      else setAssets(a);
    });
    return () => {
      gone = true;
    };
  }, []);

  // 화면 띠 재기: 장면이 바뀌면 위·아래 표시 요소가 새로 생기므로 그때마다 다시 찾는다
  const measure = () => {
    const el = root.current;
    if (!el) return null;
    const r = el.getBoundingClientRect(),
      canvas = el.closest(".game-canvas"),
      topEl = canvas?.querySelector("[data-gather-top]"),
      botEl = canvas?.querySelector("[data-gather-bottom]"),
      h = r.height || 1;
    const top = topEl ? topEl.getBoundingClientRect().bottom - r.top : h * 0.3,
      bottom = botEl ? botEl.getBoundingClientRect().top - r.top : h * 0.8;
    return {
      top: Math.max(0, Math.min(h, top)),
      bottom: Math.max(0, Math.min(h, bottom)),
    };
  };
  useEffect(() => {
    if (ready && !failed) return;
    const update = () => {
      const b = measure();
      if (b)
        setBand((o) =>
          o && Math.abs(o.top - b.top) < 1 && Math.abs(o.bottom - b.bottom) < 1
            ? o
            : b,
        );
    };
    update();
    const ro = new ResizeObserver(update);
    if (root.current) ro.observe(root.current);
    const canvas = root.current?.closest(".game-canvas");
    canvas
      ?.querySelectorAll("[data-gather-top], [data-gather-bottom]")
      .forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [shot, ready, failed, members.length]);

  useEffect(() => {
    const el = host.current;
    if (!el || !assets?.soldier) return;
    const gltf = assets.soldier;
    let alive = true;
    let frame = 0;
    const cleanups: (() => void)[] = [];

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
          { pixelRatio: Math.min(dpr, GATHER.pixelRatio), shadow: top },
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

      const mount = new THREE.Group();
      mount.name = "gather-mount";
      scene.add(mount);
      mount.add(warmProp());
      const gate = xz(ANCHORS.gate),
        axis = roadAxis(
          gate,
          ANCHORS.tower ? xz(ANCHORS.tower) : { x: 0, z: -1 },
        ),
        spots = soldierSpots(gate, axis, 4),
        center = new THREE.Vector3(
          spots.reduce((a, s) => a + s.x, 0) / spots.length,
          0,
          spots.reduce((a, s) => a + s.z, 0) / spots.length,
        ),
        outward = Math.atan2(-axis.x, -axis.z);

      // 빈 자리 점선 고리: 작은 원판을 고리 모양으로(빈 자리마다 GATHER.dots개)
      const ringR = GATHER.soldierM * 0.55 * GATHER.ring * 0.9;
      const dots = new THREE.InstancedMesh(
        new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: "#fffaf0",
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        }),
        spots.length * GATHER.dots,
      );
      dots.count = 0;
      dots.renderOrder = 2;
      dots.frustumCulled = false;
      mount.add(dots);
      let dotsFor = -1;
      const placeDots = (filled: number) => {
        if (filled === dotsFor) return;
        dotsFor = filled;
        const m = new THREE.Matrix4();
        let n = 0;
        for (let i = filled; i < spots.length; i++) {
          const s = slotSpot(spots, i);
          for (let k = 0; k < GATHER.dots; k++) {
            const a = (k / GATHER.dots) * Math.PI * 2;
            m.makeTranslation(
              s.x + Math.cos(a) * ringR,
              0.42,
              s.z + Math.sin(a) * ringR,
            );
            dots.setMatrixAt(n++, m);
          }
        }
        dots.count = n;
        dots.instanceMatrix.needsUpdate = true;
      };

      type Unit = {
        s: CrewSoldier;
        pos: THREE.Vector3;
        heading: number;
        walk: Walk | null; // 걸어 들어오는 중이면 그 길(다 오면 null)
        top: number; // 머리 꼭대기 높이(m)
      };
      const units = new Map<string, Unit>();
      let first = true,
        shown = false,
        // 이때(performance.now)까지는 소품이 튀어나오는 중이라 빠르게 그린다
        busyUntil = 0;
      const sync = () => {
        const { members: list, reveal: step, walkIn: walking } = live.current;
        for (const [id, u] of units)
          if (!list.some((m) => m.id === id)) {
            mount.remove(u.s.group);
            disposeTree(u.s.group);
            units.delete(id);
          }
        let fresh = 0;
        list.slice(0, spots.length).forEach((m, i) => {
          let u = units.get(m.id);
          if (!u) {
            const variant = soldierVariant(m.id);
            const s = crewSoldier(gltf, {
              height: GATHER.soldierM,
              role: null,
              variant,
            });
            s.group.children[1].scale.setScalar(GATHER.ring);
            const spot = slotSpot(spots, i),
              walk = walking && !reduced,
              from = walk ? spawnPoint(gate, axis, spot) : spot;
            u = {
              s,
              pos: new THREE.Vector3(from.x, 0.36, from.z),
              heading: walk
                ? Math.atan2(spot.x - from.x, spot.z - from.z)
                : spot.ry,
              // 화면을 처음 열 때 이미 모인 사람들은 차례로 걸어 나온다
              walk: walk
                ? {
                    from,
                    to: { x: spot.x, z: spot.z },
                    startAt:
                      performance.now() +
                      (first ? i : fresh) * GATHER.walk.stagger * 1000,
                    speed: GATHER.walk.speed,
                  }
                : null,
              top: GATHER.soldierM * variant.height,
            };
            if (walk) fresh++;
            s.group.position.copy(u.pos);
            s.group.rotation.y = u.heading;
            s.group.visible = !walk;
            units.set(m.id, u);
            mount.add(s.group);
          }
          // 보직 소품: 서버가 정한 보직을 공개 단계에 맞춰 보인다(처음 그릴 때는 튀지 않고 바로)
          const want = shownRole(m, step);
          if (u.s.role !== want) {
            const pop = shown && !reduced;
            u.s.setRole(want, pop);
            if (pop) busyUntil = performance.now() + 600;
          }
        });
        placeDots(Math.min(spots.length, list.length));
        first = false;
      };

      const camera = new THREE.PerspectiveCamera(40, 1, 1, SKY.radius + 20);
      // 그림자 상자는 기준 카메라 자리에 묶어 카메라가 흔들려도 그림자 지도를 자꾸 다시 그리지 않는다
      const anchorCam = new THREE.Object3D();
      const cur = {
        aim: new THREE.Vector3(),
        dist: 40,
        el: GATHER.elevation.line,
        az: 0,
        set: false,
      };
      const want = { aim: new THREE.Vector3(), dist: 40, el: 0, az: 0 };
      let viewKey = "",
        anchorKey = "";
      const place = (
        cam: THREE.Object3D,
        aim: THREE.Vector3,
        az: number,
        d: number,
        el: number,
      ) => {
        const a = outward + az;
        cam.position.set(
          aim.x + Math.sin(a) * Math.cos(el) * d,
          aim.y + Math.sin(el) * d,
          aim.z + Math.cos(a) * Math.cos(el) * d,
        );
      };
      const tagPoint = new THREE.Vector3();
      const frameView = () => {
        const w = el.clientWidth || 1,
          h = el.clientHeight || 1,
          b = measure() ?? { top: h * 0.3, bottom: h * 0.8 };
        const key = `${w}x${h}:${Math.round(b.top)}:${Math.round(b.bottom)}`;
        if (key !== viewKey) {
          viewKey = key;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.fov = w / h < 0.8 ? 46 : 34;
          camera.setViewOffset(w, h, 0, bandOffset(h, b.top, b.bottom), w, h);
          camera.updateProjectionMatrix();
        }
        // 지도 출처(ODbL)는 아래 판 바로 위 오른쪽에 둔다
        if (credit.current)
          credit.current.style.top = `${Math.max(0, b.bottom - 18)}px`;
        // 지금 구도가 바라볼 곳과 거리
        const { shot: s, members: list } = live.current;
        const me = list.find((m) => m.self),
          mine = me ? units.get(me.id) : undefined,
          index = me ? list.indexOf(me) : -1;
        const bandH = Math.max(1, b.bottom - b.top);
        if (s === "self" && index >= 0) {
          const spot = slotSpot(spots, index);
          want.aim.set(spot.x, GATHER.soldierM * 0.56, spot.z);
          if (mine && !mine.walk)
            want.aim.set(mine.pos.x, want.aim.y, mine.pos.z);
          want.dist = viewDistance({
            viewW: w,
            viewH: h,
            bandH,
            fov: camera.fov,
            share: GATHER.share.self,
          });
          want.el = GATHER.elevation.self;
          want.az = GATHER.azimuth.self;
        } else {
          want.aim.copy(center).setY(GATHER.soldierM * HOME.aim);
          want.dist = viewDistance({
            viewW: w,
            viewH: h,
            bandH,
            fov: camera.fov,
            share: GATHER.share.line,
            span: GATHER.span,
          });
          want.el = GATHER.elevation.line;
          want.az = GATHER.azimuth.line;
        }
        // 그림자 기준 카메라는 구도가 바뀔 때만 옮긴다
        const ak = `${s}:${Math.round(want.dist)}:${Math.round(want.aim.x)}:${Math.round(want.aim.z)}`;
        if (ak !== anchorKey) {
          anchorKey = ak;
          place(anchorCam, want.aim, want.az, want.dist, want.el);
          anchorCam.updateMatrixWorld();
          light.invalidate();
        }
      };

      const stats: GatherStats | null =
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
              soldiers: 0,
              rate: 0,
            }
          : null;
      if (stats) window.__gatherStats = stats;

      let last = -1,
        rate: number = GATHER.fps.active,
        // 걸음·카메라·소품이 다 멈췄으면 false: 숨쉬기만 남으니 덜 자주 그린다
        active = true;
      const draw = (t: number) => {
        const frameMs = last < 0 ? 0 : t - last,
          dt = Math.min(0.1, frameMs / 1000);
        last = t;
        sync();
        frameView();
        // 걸어 들어오기와 자리에서 카메라 쪽으로 돌아서기
        let moving = false,
          waiting = false,
          turning = false;
        live.current.members.slice(0, spots.length).forEach((m, i) => {
          const u = units.get(m.id);
          if (!u) return;
          const spot = slotSpot(spots, i);
          // 걷는 중에 자리가 바뀌었으면(드문 경우) 지금 자리에서 새 자리로 다시 걷는다
          if (
            u.walk &&
            Math.hypot(u.walk.to.x - spot.x, u.walk.to.z - spot.z) > 0.01
          )
            u.walk = {
              ...u.walk,
              from: { x: u.pos.x, z: u.pos.z },
              to: { x: spot.x, z: spot.z },
              startAt: Math.max(t, u.walk.startAt),
            };
          let speed = 0;
          if (u.walk) {
            const at = walkAt(u.walk, t);
            u.s.group.visible = at.started;
            if (!at.started) {
              waiting = true;
              u.s.animate(dt, false, 0);
              return;
            }
            speed = u.walk.speed;
            u.heading = turnToward(
              u.heading,
              Math.atan2(
                u.walk.to.x - u.walk.from.x,
                u.walk.to.z - u.walk.from.z,
              ),
              dt * 8,
            );
            u.pos.set(at.x, u.pos.y, at.z);
            if (at.arrived) u.walk = null;
            moving = true;
          } else {
            // 자리가 바뀌었으면(드문 경우) 바로 옮겨 선다
            if (Math.hypot(u.pos.x - spot.x, u.pos.z - spot.z) > 0.01)
              u.pos.set(spot.x, u.pos.y, spot.z);
            u.heading = turnToward(u.heading, spot.ry, reduced ? 1 : dt * 3);
            if (Math.abs(Math.sin((spot.ry - u.heading) / 2)) > 0.005)
              turning = true;
          }
          u.s.group.position.copy(u.pos);
          u.s.group.rotation.y = u.heading;
          u.s.animate(dt, !!u.walk, speed);
        });
        // 카메라: 새 구도로 부드럽게 옮겨 간다(흔들지 않는다: 다 서면 덜 자주 그리게)
        const k = !cur.set || reduced ? 1 : 1 - Math.exp(-dt * GATHER.ease);
        cur.set = true;
        cur.aim.lerp(want.aim, k);
        cur.dist += (want.dist - cur.dist) * k;
        cur.el += (want.el - cur.el) * k;
        cur.az += (want.az - cur.az) * k;
        const easing =
          cur.aim.distanceToSquared(want.aim) > 1e-4 ||
          Math.abs(want.dist - cur.dist) > 0.02 ||
          Math.abs(want.el - cur.el) + Math.abs(want.az - cur.az) > 1e-3;
        active = moving || waiting || turning || easing || t < busyUntil;
        place(camera, cur.aim, cur.az, cur.dist, cur.el);
        camera.lookAt(cur.aim);
        sky.position.copy(camera.position);
        const fog = scene.fog as THREE.Fog,
          d = camera.position.distanceTo(cur.aim);
        fog.near = d + HOME.fog.near;
        fog.far = Math.max(fog.near + 60, HOME.fog.far);
        camera.updateMatrixWorld();
        world.update(cur.aim.x, cur.aim.z, camera);
        const shadowFrame = light.follow(
          new THREE.Vector3(cur.aim.x, 0, cur.aim.z),
          anchorCam as THREE.Camera,
          moving,
        );
        // 품질 조절은 프레임 간격을 60장 기준으로 바꿔 넣는다(30장이면 반, 15장이면 4분의 1)
        if (!reduced && quality.tick(frameMs * (rate / 60))) apply();
        renderer.render(scene, camera);
        // 머리 위 이름표: 장병 머리 꼭대기(빈 자리는 고리 위)를 화면 자리로 옮긴다
        const w = el.clientWidth || 1,
          h = el.clientHeight || 1;
        for (let i = 0; i < spots.length; i++) {
          const tag = tags.current[i];
          if (!tag) continue;
          const m = live.current.members[i],
            u = m ? units.get(m.id) : undefined;
          if (u && !u.s.group.visible) {
            tag.style.opacity = "0";
            continue;
          }
          if (u) tagPoint.set(u.pos.x, u.top * 1.03, u.pos.z);
          else {
            const s = slotSpot(spots, i);
            tagPoint.set(s.x, GATHER.soldierM * 0.18, s.z);
          }
          tagPoint.project(camera);
          const x = ((tagPoint.x + 1) / 2) * w,
            y = ((1 - tagPoint.y) / 2) * h;
          tag.style.opacity = tagPoint.z < 1 ? "1" : "0";
          tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        }
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
          stats.soldiers = units.size;
          stats.rate = active ? GATHER.fps.active : GATHER.fps.settled;
          stats.frames++;
        }
        if (!shown) {
          shown = true;
          setReady(true);
        }
      };

      // 움직이는 동안 초당 30장, 다 서면 15장. 탭이 숨거나 위를 덮는 화면이 있으면 멈추고,
      // 움직임 줄이기 설정이면 가끔만 그린다. 합류·공개 같은 변화는 다음 장(최대 1/15초)에 잡힌다.
      let prev = -Infinity;
      const loop = (t: number) => {
        frame = 0;
        if (!alive || document.hidden || core.lost) return;
        frame = requestAnimationFrame(loop);
        if (live.current.hidden && shown) return;
        rate = active ? GATHER.fps.active : GATHER.fps.settled;
        if (t - prev < (reduced ? 250 : 1000 / rate - 2)) return;
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
      sync();
      frameView();
      place(camera, want.aim, want.az, want.dist, want.el);
      camera.lookAt(want.aim);
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
        if (stats && window.__gatherStats === stats)
          delete window.__gatherStats;
        // 장병·점선 고리는 지금 지우고, 지도·렌더러는 다음 화면(이동 화면)이 다시 쓰도록 맡긴다
        scene.remove(mount);
        disposeTree(mount);
        renderer.domElement.remove();
        core.onRestore = null;
        releaseCore(core);
      });
    };

    // 모형은 이미 받아 두었고 지도도 첫 화면에서 구웠을 수 있다. 화면이 뜬 뒤 숨 돌리고 시작한다.
    const idle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(start, { timeout: 400 })
        : 0;
    const timer = idle ? undefined : setTimeout(start, 120);
    cleanups.push(() => {
      if (idle) window.cancelIdleCallback(idle);
      clearTimeout(timer);
    });
    return () => {
      alive = false;
      for (const f of cleanups.reverse()) f();
    };
  }, [assets, epoch]);

  const flat = failed || !ready;
  return (
    <div
      ref={root}
      className={`gather-stage ${ready && !failed ? "ready" : ""}`}
      data-state={failed ? "flat" : ready ? "3d" : "loading"}
    >
      <div className="gather-poster" aria-hidden="true">
        {fallback}
      </div>
      {!failed && <div ref={host} className="gather-3d" aria-hidden="true" />}
      <ol
        className={`gather-tags ${flat ? "flat" : ""}`}
        aria-label="작전 인원"
        style={
          flat && band
            ? { top: band.top, height: Math.max(0, band.bottom - band.top) }
            : undefined
        }
      >
        {Array.from({ length: 4 }, (_, i) => {
          const m = members[i],
            role = m ? shownRole(m, reveal) : null,
            Icon = role ? ROLE_ICONS[role] : null;
          return (
            <li
              key={m?.id ?? `empty-${i}`}
              ref={(n) => {
                tags.current[i] = n;
              }}
              className={`gather-tag ${m ? "" : "empty"} ${m?.self ? "self" : ""}`}
              style={
                role
                  ? ({ "--role": ROLE_COLORS[role] } as CSSProperties)
                  : undefined
              }
            >
              {m ? (
                <>
                  <span className="gather-tag-name">
                    <b>{m.nickname}</b>
                    {m.self && <small>나</small>}
                    {shot === "self" && m.ready && (
                      <Check size={13} aria-label="준비 완료" />
                    )}
                  </span>
                  {role && Icon && (
                    <span className="gather-tag-role">
                      <Icon size={12} aria-hidden="true" />
                      {ROLE_NAMES[role]}
                    </span>
                  )}
                </>
              ) : (
                <span className="gather-tag-empty">0{i + 1} · 빈 자리</span>
              )}
            </li>
          );
        })}
      </ol>
      {ready && !failed && (
        <span ref={credit} className="gather-credit">
          {MAP.credit}
        </span>
      )}
    </div>
  );
}
