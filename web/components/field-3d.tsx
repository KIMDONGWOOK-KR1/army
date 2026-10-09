"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { heroSoldier, loadFieldAssets, type FieldAssets } from "./field-assets";
import { crewSoldier } from "./soldier-props";
import { soldierVariant } from "./soldier-variants";
import type { Role } from "@/supabase/functions/_shared/types";
import { soldier } from "./field-kit";
import { makeLight, type FieldLight } from "./field-light";
import { buildMap, type MapData, type MapWorld } from "./field-map";
import {
  ghostOpacity,
  prewarmSeeThrough,
  resetSeeThrough,
  seeThroughProbeMs,
  setClayRim,
  updateSeeThrough,
} from "./field-occlusion";
import {
  AdaptiveQuality,
  fieldFlags,
  qualityLevels,
  statsProbe,
} from "./field-perf";
import { inCalm } from "./field-calm";
import { fogFor, maxPolarFor, VIEW } from "./field-view";
import {
  footRipple,
  markerAt,
  routeDots,
  stopMarker,
  type StopState,
} from "./field-stop";
import jnu from "./maps/jnu.json";
import { closestAlong, pointAlong, projector, type XZ } from "@/lib/geo";

// 실제 축척 캠퍼스 지도 위에서 내 GPS 위치를 따라 걷는 입체 필드.
// 지도는 오픈스트리트맵에서 구운 자료(maps/jnu.json, 1단위 = 1m)를 민트빛 지도로 깔고,
// 정문·용봉관·용봉탑은 블렌더 점토 모형으로 세운다. 캠퍼스 안에서 위치를 받으면
// 캐릭터가 그 자리로 걸어가고, 위치가 없거나 캠퍼스 밖이면 다음 거점까지 실제
// 도보 경로를 따라 걷는 시연 이동을 보여 준다. 거점 표석은 거점 옆(랜드마크를 가리지 않는
// 자리)에 서 있다가 도착 반경에 들어서면 받침 위에 기록 액자를 세우고, 누르면 도착을 알린다.
const MAP = jnu as unknown as MapData;
const ON_MAP_M = 1500, // 지도 원점(정문)에서 이보다 멀면 캠퍼스 밖으로 본다
  DEMO_SPEED = 7, // 시연 이동 속도(m/s)
  FAST_SPEED = 16, // 발표용 자동 시연의 이동 속도(m/s)
  ACCEL = 4, // 시연 이동이 출발할 때 빨라지는 정도(m/s²)
  DECEL = 3, // 거점 앞에서 멈출 때 느려지는 정도(m/s²)
  MAX_SPEED = 9, // GPS를 따라갈 때 최대 속도(m/s)
  JITTER_M = 2.5, // 멈춰 있을 때 GPS 흔들림은 무시한다
  QUIET_EXIT_M = 10, // 조용한 구역에서 나왔다고 보는 여유(m)
  AVATAR = 3.2, // 지도에서 잘 보이게 키운 코드 캐릭터 배율(약 7m)
  HERO_M = 8.5, // 블렌더 장병 모형의 지도 위 키(m)
  FACE_AFTER = 1.5, // 이만큼(초) 멈춰 있으면 카메라 쪽으로 돌아 얼굴을 보여 준다
  VIEW_SHIFT = 0.06; // 캐릭터를 화면 가운데보다 이만큼(화면 높이 비율) 아래에 둔다
// 하늘(위)과 지평선 안개 색. 땅은 멀어질수록 지평선 색으로 흐려진다.
// 안개는 카메라에서 캐릭터까지 거리(d)에 맞춰 d + fogNear ~ d + fogFar로 옮긴다: 멀리 당겨도
// 캐릭터 둘레 지도는 또렷하고 지평선 쪽만 흐려진다. 카메라는 하늘 공(radius) 안까지만 그린다.
export const SKY = {
  top: "#62b9ef",
  horizon: "#d5eff6",
  radius: 660,
};
// 기록 액자에 넣을 그림(world.sites 차례: 정문, 용봉관)
const STOP_IMAGES = ["/stops/gate.webp", "/stops/yongbong.webp"];

export type FieldFix = { lat: number; lng: number; accuracy: number };
// 화면 위 표시(남은 거리 등)를 그리는 쪽에 1초에 네 번까지 알리는 필드 상태
export type FieldStatus = {
  distance: number; // 지금 거점까지 남은 거리(m)
  inRange: boolean; // 거점 도착 반경 안
  // 5·18 조용한 구역 안: 추모 거점으로 가는 길이면 도착 범위나 어느 조용한 구역이든,
  // 아니면 지금 거점(추모 아님)을 덮는 구역만 빼고. 배경음을 북·가락 없는 숨결로 낮춘다.
  quiet: boolean;
  mode: "gps" | "outside" | "demo"; // GPS를 따라감 / 캠퍼스 밖이라 시연 이동 / 위치 없이 시연 이동
  accuracy: number | null; // GPS 오차(m)
  loading: boolean; // 블렌더 모형을 받는 중
  failed: boolean; // 이 기기에서 입체 지도를 그리지 못했다
};
export type FieldTarget = {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  // 추모 장소: 표석이 흔들리거나 되튀지 않고 도착 원이 깜빡이지 않는다
  reverent?: boolean;
};

// 카메라를 둘러싼 하늘 공: 위는 파랗고 지평선 쪽은 옅은 안개 색
function skyDome() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(SKY.radius, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY.top) },
        horizon: { value: new THREE.Color(SKY.horizon) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main(){
          float h = smoothstep(0.0, 0.42, vDir.y);
          gl_FragColor = vec4(mix(horizon, top, h), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

// 지도 위 내 캐릭터: 블렌더 장병(C02) 모형, 못 받았으면 코드로 만든 장병.
// animate는 걷는지와 빠르기에 맞춰 동작을 틀고 땅에서 띄울 높이를 정한다.
type Avatar = {
  group: THREE.Group;
  animate(dt: number, moving: boolean, speed: number, t: number): void;
};
// role이 있으면 보직 소품과 사람마다 다른 모습(look: 멤버 id에서 정한다)을 입힌다.
function avatar(
  assets: FieldAssets,
  roleColor: string,
  role: Role | null,
  look: string,
): Avatar {
  if (assets.soldier) {
    const hero = role
      ? crewSoldier(assets.soldier, {
          height: HERO_M,
          role,
          variant: soldierVariant(look),
        })
      : heroSoldier(assets.soldier, roleColor, HERO_M);
    return {
      group: hero.group,
      animate(dt, moving, speed) {
        hero.animate(dt, moving, speed);
        // 길·물길 바닥(높이 0.35m까지) 위에 발을 딛게 한다
        hero.group.position.y = 0.36;
      },
    };
  }
  const p = soldier(roleColor);
  p.group.scale.setScalar(AVATAR);
  let phase = 0;
  return {
    group: p.group,
    // 걷는 동안 다리·팔을 흔들고 통통 튄다. 멈추면 숨쉬듯 천천히 움직인다.
    animate(dt, moving, speed, t) {
      phase += dt * (moving ? 7 + speed * 0.6 : 0);
      const swing = moving ? Math.sin(phase) * 0.7 : 0;
      p.legs[0].rotation.x = swing;
      p.legs[1].rotation.x = -swing;
      p.arms[0].rotation.x = -swing * 0.8;
      p.arms[1].rotation.x = swing * 0.8;
      p.head.rotation.z = moving ? Math.sin(phase / 2) * 0.05 : 0;
      p.group.position.y =
        0.4 +
        (moving ? Math.abs(Math.sin(phase)) * 0.5 : Math.sin(t / 700) * 0.1);
    },
  };
}

// 바닥에 눕힌 원: 옅은 채움과 또렷한 테두리. rim을 주면 테두리 바깥에 폭(m)이 일정한
// 남색 테를 한 겹 더 둘러 풀빛 바탕 위에서도 원이 또렷하게 한다(스타일 시트 2.2).
const NAVY = "#1f2a44";
function groundCircle(
  color: string,
  fill: number,
  line: number,
  rim?: { width: number; opacity: number },
) {
  const g = new THREE.Group();
  const mat = (opacity: number, c = color) =>
    new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity,
      depthWrite: false,
    });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 72), mat(fill));
  const edge = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), mat(line));
  const band = rim
    ? new THREE.Mesh(new THREE.BufferGeometry(), mat(rim.opacity, NAVY))
    : null;
  for (const m of band ? [disc, edge, band] : [disc, edge]) {
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    g.add(m);
  }
  g.position.y = 0.45;
  let shown = 0;
  return {
    group: g,
    disc,
    edge,
    // 반지름(m)을 바꾼다. 남색 테는 반지름이 바뀔 때만 다시 만든다.
    setRadius(r: number) {
      disc.scale.setScalar(r);
      edge.scale.setScalar(r);
      if (!band || !rim || r === shown) return;
      shown = r;
      band.geometry.dispose();
      band.geometry = new THREE.RingGeometry(r, r + rim.width, 96);
    },
  };
}

// 렌더러·장면·지도·빛은 한 번 만들어 두고, 거점이 바뀌어 이동 화면을 다시 열어도
// 그대로 다시 쓴다(지도를 다시 굽지 않고 셰이더도 다시 컴파일하지 않는다).
// 첫 화면 입체 배경(home-hero.tsx)도 같은 것을 빌려 써서, 작전을 시작해 이동 화면이 뜰 때 다시 굽지 않는다.
// 이동 화면이 닫힌 채 KEEP_MS가 지나면 모두 지운다.
const KEEP_MS = 5 * 60 * 1000;
export type Core = {
  assets: FieldAssets;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sky: THREE.Mesh;
  world: MapWorld;
  light: FieldLight;
  quality: AdaptiveQuality;
  phone: boolean;
  lost: boolean;
  warmed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  // 잃었던 WebGL 문맥이 돌아왔을 때 지금 화면이 새 렌더러로 다시 뜨게 한다
  onRestore: (() => void) | null;
};
let core: Core | null = null;

function makeCore(assets: FieldAssets): Core {
  // WebGL을 못 쓰는 기기에서는 여기서 예외가 나고, 필드 대신 그림을 보여 준다
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const phone = Math.min(window.innerWidth, window.innerHeight) < 600;
  const quality = new AdaptiveQuality(
    qualityLevels(window.devicePixelRatio || 1, phone),
    fieldFlags(window.location.search).pinned,
  );
  renderer.setPixelRatio(quality.current.pixelRatio);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY.horizon);
  scene.fog = new THREE.Fog(SKY.horizon, fogFor(74).near, fogFor(74).far);
  const sky = skyDome();
  scene.add(sky);
  const light = makeLight(scene, renderer, quality.current.shadow, phone);
  let world: MapWorld;
  try {
    world = buildMap(scene, MAP, assets);
  } catch (e) {
    disposeTree(scene);
    renderer.dispose();
    throw e;
  }
  const c: Core = {
    assets,
    renderer,
    scene,
    sky,
    world,
    light,
    quality,
    phone,
    lost: false,
    warmed: false,
    timer: null,
    onRestore: null,
  };
  // 폰은 백그라운드로 가거나 메모리가 모자라면 WebGL 문맥을 잃는다. 돌아와도 이 렌더러·장면은
  // 다시 쓰지 않는다(lost를 그대로 둔다): 지금 화면이 다시 뜨면서 새 렌더러와 장면을 만든다.
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault(); // 브라우저가 문맥을 되돌려 주게 한다
    c.lost = true;
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    c.lost = true;
    light.invalidate();
    c.onRestore?.();
  });
  return c;
}

// 물체 묶음의 형상·재질·무늬를 지운다(다른 화면에서도 쓰는 shared 표시는 남긴다)
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.geometry.userData.shared) o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      for (const v of Object.values(m))
        if (v instanceof THREE.Texture && !v.userData.shared) v.dispose();
      m.dispose();
    });
  });
}

function disposeCore(c: Core) {
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
  if (core === c) core = null;
  disposeTree(c.scene);
  c.light.sun.shadow.dispose();
  c.renderer.dispose();
  c.renderer.forceContextLoss();
}

export function acquireCore(assets: FieldAssets): Core {
  if (core && (core.assets !== assets || core.lost)) disposeCore(core);
  core ??= makeCore(assets);
  if (core.timer) clearTimeout(core.timer);
  core.timer = null;
  return core;
}

export function releaseCore(c: Core) {
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => disposeCore(c), KEEP_MS);
}

export function Field3D({
  siteSeq,
  siteName,
  fix,
  target,
  distance,
  roleColor,
  role = null,
  look = "",
  fallback,
  fast = false,
  simulateMovement = true,
  onStatus,
  onMarkerTap,
}: {
  siteSeq: number;
  siteName: string;
  fix: FieldFix | null;
  target: FieldTarget;
  distance: number | null;
  roleColor: string;
  // 내 보직(소품)과 모습을 정하는 값(멤버 id). 없으면 소품 없는 장병.
  role?: Role | null;
  look?: string;
  fallback: ReactNode;
  // 발표용 자동 시연: 시연 이동을 빠르게 하고 카메라를 살짝 물린다
  fast?: boolean;
  simulateMovement?: boolean;
  onStatus?: (status: FieldStatus) => void;
  // 도착 반경 안에서 거점 표석을 눌렀다
  onMarkerTap?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({
    siteSeq,
    siteName,
    fix,
    target,
    distance,
    fast,
    simulateMovement,
    onStatus,
    onMarkerTap,
  });
  live.current = {
    siteSeq,
    siteName,
    fix,
    target,
    distance,
    fast,
    simulateMovement,
    onStatus,
    onMarkerTap,
  };
  const [failed, setFailed] = useState(false);
  // WebGL 문맥을 잃었다 되찾으면 올려 화면을 새 렌더러로 다시 띄운다
  const [epoch, setEpoch] = useState(0);
  // 블렌더 모형(처음 한 번만 받는다). 받기 전에는 칩에 알리고 기다린다.
  const [assets, setAssets] = useState<FieldAssets | null>(null);
  useEffect(() => {
    let gone = false;
    live.current.onStatus?.({
      distance: 0,
      inRange: false,
      quiet: false,
      mode: "demo",
      accuracy: null,
      loading: true,
      failed: false,
    });
    loadFieldAssets().then((a) => {
      if (!gone) setAssets(a);
    });
    return () => {
      gone = true;
    };
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el || !assets) return;
    let c: Core;
    try {
      c = acquireCore(assets);
    } catch {
      setFailed(true);
      live.current.onStatus?.({
        distance: 0,
        inRange: false,
        quiet: false,
        mode: "demo",
        accuracy: null,
        loading: false,
        failed: true,
      });
      return;
    }
    const { renderer, scene, sky, world, light, quality, phone } = c;
    c.onRestore = () => setEpoch((n) => n + 1);
    el.prepend(renderer.domElement);
    quality.restart();
    // 첫 화면(home-hero.tsx)이 같은 렌더러를 낮은 화질로 썼을 수 있어 이 화면 화질로 되돌린다
    renderer.setPixelRatio(quality.current.pixelRatio);
    light.setShadowSize(quality.current.shadow);
    light.invalidate();
    resetSeeThrough();
    // 개발 점검 도구(?dev=1)는 개발 빌드에서만 켠다(배포 빌드에 장면 내부를 드러내지 않는다)
    const probe =
      process.env.NODE_ENV !== "production" &&
      fieldFlags(window.location.search).dev
        ? statsProbe()
        : null;
    const P = projector(MAP.origin);
    // 이번 화면에서만 쓰는 것(표석·원·캐릭터)은 한 묶음에 넣어 닫을 때 한꺼번에 뺀다
    const mount = new THREE.Group();
    mount.name = "field-mount";
    scene.add(mount);

    // 거점 표석: 도착을 재는 거점 자리(노란 원)에서 비켜, 랜드마크를 가리지 않는 자리에 선다.
    // 도착하면 받침 위에 기록 액자를 세운다(field-stop.ts).
    const stops = world.sites.map((site, i) => {
      const m = stopMarker(STOP_IMAGES[i] ?? null),
        at = markerAt(i, site);
      m.group.position.set(at.x, 0, at.z);
      mount.add(m.group);
      return m;
    });
    const siteRing = groundCircle("#ffc53d", 0.12, 0.8, {
      width: 0.25,
      opacity: 0.6,
    });
    const accRing = groundCircle("#3d8bfd", 0.14, 0.65);
    const ripple = footRipple();
    const dots = routeDots();
    mount.add(siteRing.group, accRing.group, ripple.group, dots.mesh);
    const player = avatar(assets, roleColor, role, look);
    // 나무·건물에 가려도 캐릭터 윤곽이 역할 색으로 비쳐 보이게 한다. 비침(5)을 먼저,
    // 캐릭터(6)를 나중에 그려 캐릭터 몸끼리는 비치지 않는다. 시야 구멍(field-occlusion)이
    // 가린 것을 지우므로 비침은 옅게 두고, 구멍이 열리면 조금 더 낮춘다. 비침 복제본은
    // 무언가 캐릭터를 가릴 때(구멍이 열려 있는 동안)만 그려 뼈대 계산(3만 삼각형)을 아낀다.
    const ghost = new THREE.MeshBasicMaterial({
      color: roleColor,
      transparent: true,
      opacity: ghostOpacity(0),
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
    });
    const bodies: THREE.Mesh[] = [],
      ghosts: THREE.Mesh[] = [];
    player.group.traverse((o) => {
      if (o instanceof THREE.Mesh) bodies.push(o);
    });
    for (const m of bodies) {
      // 뼈대 모형은 같은 뼈를 따라 움직이는 복제본으로 비친다
      const x =
        m instanceof THREE.SkinnedMesh
          ? m.clone()
          : new THREE.Mesh(m.geometry, ghost);
      x.material = ghost;
      x.position.set(0, 0, 0);
      x.rotation.set(0, 0, 0);
      x.scale.set(1, 1, 1);
      x.castShadow = false;
      x.frustumCulled = m.frustumCulled;
      x.renderOrder = 5;
      x.visible = false;
      ghosts.push(x);
      m.add(x);
      // 비침 다음에 그리려고 투명 묶음에 넣을 뿐 실제로 비치지는 않는다. 양면 재질이
      // 투명이면 three가 뒷면·앞면 두 번 그리므로(장병 3만 삼각형 × 2) 한 번만 그리게 한다.
      const body = m.material as THREE.Material;
      body.transparent = true;
      body.forceSinglePass = true;
      m.renderOrder = 6;
    }
    mount.add(player.group);

    const camera = new THREE.PerspectiveCamera(40, 1, 2, SKY.radius + 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, {
      enablePan: false,
      enableDamping: true,
      dampingFactor: 0.12,
      rotateSpeed: 0.6,
      zoomSpeed: 0.8,
      minDistance: 30,
      maxDistance: 240,
      minPolarAngle: VIEW.minPolar,
      maxPolarAngle: maxPolarFor(0),
    });

    const resize = () => {
      const w = el.clientWidth || 1,
        h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 46 : 36;
      // 포켓몬고처럼 캐릭터를 화면 아래쪽에 두어 앞길과 하늘을 넓게 보여 준다
      camera.setViewOffset(w, h, 0, -h * VIEW_SHIFT, w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // 지금 거점 자리: 코스에 실제 좌표가 있으면 그 자리, 없으면 지도에서 잡은 자리
    const siteAt = (seq: number): XZ => {
      const t = live.current.target;
      if (seq === live.current.siteSeq && t.lat !== null && t.lng !== null)
        return P.toLocal({ lat: t.lat, lng: t.lng });
      return world.sites[Math.max(0, Math.min(seq, world.sites.length) - 1)];
    };
    const legOf = (seq: number) =>
      Math.max(0, Math.min(seq, world.legs.length) - 1);
    // 내 위치가 캠퍼스 지도 안이면 그 자리(m), 아니면 null
    const fixOnMap = () => {
      const f = live.current.fix;
      if (!f) return null;
      const p = P.toLocal(f);
      return Math.hypot(p.x, p.z) < ON_MAP_M ? p : null;
    };

    const pos = new THREE.Vector3();
    let seqNow = live.current.siteSeq,
      goal: XZ = pointAlong(world.legs[legOf(seqNow)], 0),
      demoS = 0,
      demoV = 0,
      heading = 0,
      speed = 0,
      still = 0,
      extra = 0,
      extraShown = 0,
      insideNow = false,
      quietNow = false;
    const first = fixOnMap();
    if (first) goal = first;
    pos.set(goal.x, 0, goal.z);
    // 처음(과 거점이 바뀔 때)에는 캐릭터 뒤에서 거점 쪽을 바라본다
    const R0 = phone ? 74 : 100,
      PHI = VIEW.defaultPolar;
    const aimCamera = (seq: number) => {
      const aim = siteAt(seq),
        back = Math.atan2(pos.x - aim.x, pos.z - aim.z);
      heading = back + Math.PI;
      controls.target.set(pos.x, 4, pos.z);
      camera.position.set(
        pos.x + R0 * Math.sin(PHI) * Math.sin(back),
        4 + R0 * Math.cos(PHI),
        pos.z + R0 * Math.sin(PHI) * Math.cos(back),
      );
      extra = extraShown = 0;
      controls.update();
    };
    aimCamera(seqNow);
    // 지우는 시야 구멍 셰이더를 처음 한 번 미리 컴파일해 둔다(처음 가려질 때 튀지 않게)
    if (!c.warmed) {
      c.warmed = true;
      prewarmSeeThrough(renderer, scene, camera);
    }
    if (probe)
      window.__field = { renderer, scene, camera, light, controls, setClayRim };
    // 표석이 조용한 구역(5·18 사적지) 안인가: 코스의 추모 표시나 지도 위 조용한 구역
    const calmAt = (x: number, z: number) => inCalm(world.calm, x, z);

    // 거점 표석을 누르면(끌지 않고 짧게 눌렀을 때만) 도착 반경 안이면 도착을 알리고,
    // 아직 멀면 표석을 살짝 흔들어 닫혀 있다고 보여 준다
    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    let press: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      press = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const p = press;
      press = null;
      if (
        !p ||
        Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10 ||
        performance.now() - p.t > 500
      )
        return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const m = stops[live.current.siteSeq - 1];
      if (!m || !ray.intersectObject(m.hit, false).length) return;
      if (insideNow) live.current.onMarkerTap?.();
      else m.nudge();
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const follow = new THREE.Vector3(),
      offset = new THREE.Vector3();
    let frame = 0,
      last = performance.now(),
      shown = 0;
    const loop = (t: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden) return;
      const frameMs = t - last,
        dt = Math.min(0.05, frameMs / 1000);
      last = t;
      const { siteSeq: seq, target: tg, distance: judged } = live.current;
      const site = siteAt(seq),
        radius = tg.radiusM || world.radius;

      // 거점이 바뀌면(지도는 그대로 두고) 시연 이동을 새 다리 처음부터 다시 시작한다
      const gps = fixOnMap();
      if (seq !== seqNow) {
        seqNow = seq;
        demoS = demoV = 0;
        if (!gps) {
          goal = pointAlong(world.legs[legOf(seq)], 0);
          pos.set(goal.x, 0, goal.z);
        }
        aimCamera(seq);
      }

      // 목표 자리: 캠퍼스 안 GPS 위치, 또는 실제 도보 경로를 따라가는 시연 이동.
      // 시연 이동은 천천히 출발해 거점 앞에서 서서히 멈춘다(자동 시연은 더 빠르게).
      let nx = pos.x,
        nz = pos.z;
      if (gps) {
        demoV = 0;
        if (Math.hypot(gps.x - goal.x, gps.z - goal.z) > JITTER_M) goal = gps;
      } else if (live.current.simulateMovement) {
        const k = legOf(seq),
          stop = Math.max(0, world.legLength[k] - radius * 0.5),
          cruise = live.current.fast ? FAST_SPEED : DEMO_SPEED,
          brake = Math.sqrt(2 * DECEL * Math.max(0, stop - demoS)),
          want = Math.min(cruise, brake);
        demoV = want > demoV ? Math.min(want, demoV + ACCEL * dt) : want;
        demoS = Math.min(stop, demoS + demoV * dt);
        goal = pointAlong(world.legs[k], demoS);
      }
      const dx = goal.x - pos.x,
        dz = goal.z - pos.z,
        d = Math.hypot(dx, dz);
      if (d > 150) {
        nx = goal.x;
        nz = goal.z;
      } else if (d > 0.01) {
        const v = gps
          ? Math.min(MAX_SPEED, d * 1.1)
          : Math.max(demoV * 1.2, Math.min(MAX_SPEED, d * 2.2));
        const step = Math.min(d, v * dt);
        nx += (dx / d) * step;
        nz += (dz / d) * step;
      }
      const mx = nx - pos.x,
        mz = nz - pos.z,
        md = Math.hypot(mx, mz);
      pos.set(nx, 0, nz);
      speed += (md / Math.max(dt, 1e-3) - speed) * Math.min(1, dt * 6);
      const moving = speed > 0.35;
      still = moving ? 0 : still + dt;
      if ((moving && md > 1e-3) || still > FACE_AFTER) {
        const want = moving
          ? Math.atan2(mx, mz)
          : Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);
        let diff = want - heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        heading += diff * Math.min(1, dt * (moving ? 8 : 2.5));
      }
      player.animate(dt, moving, speed, t);
      player.group.visible = !!gps || live.current.simulateMovement;
      player.group.position.x = pos.x;
      player.group.position.z = pos.z;
      player.group.rotation.y = heading;

      // 거점 표석과 도착 반경 원, 내 위치 오차 원. 남은 거리는 실제 좌표가 있는 코스면
      // 도착 판정과 같은 값(최근 세 번 위치의 평균)을, 아니면 캐릭터 자리를 쓴다.
      // 조용한 구역(코스의 추모 거점이거나 지도 위 5·18 구역 안)에서는 표석이 돌거나 튀지 않고
      // 원이 깜빡이지 않는다.
      const remain =
          judged !== null
            ? judged
            : live.current.simulateMovement ? Math.hypot(site.x - pos.x, site.z - pos.z) : Infinity,
        inside = remain <= radius,
        calm = !!tg.reverent || calmAt(site.x, site.z);
      insideNow = inside;
      // 조용한 구역: 들어설 때는 구역 경계에서, 나갈 때는 QUIET_EXIT_M 더 벗어나야(GPS 흔들림에 배경음이
      // 들락날락하지 않게)
      const pad = quietNow ? QUIET_EXIT_M : 0;
      quietNow =
        (!!tg.reverent && remain <= radius + pad) ||
        world.calm.some(
          (z) =>
            Math.hypot(pos.x - z.x, pos.z - z.z) < z.r + pad &&
            (!!tg.reverent || Math.hypot(site.x - z.x, site.z - z.z) >= z.r),
        );
      stops.forEach((m, i) => {
        const state: StopState =
            i < seq - 1 ? "done" : i === seq - 1 ? "now" : "next",
          base = state === "now" ? site : world.sites[i],
          at = markerAt(i, base);
        m.group.position.set(at.x, 0, at.z);
        m.update({
          t,
          dt,
          camera,
          open: inside,
          state,
          calm: state === "now" ? calm : calmAt(base.x, base.z),
        });
      });
      siteRing.group.position.set(site.x, 0.45, site.z);
      siteRing.setRadius(radius);
      (siteRing.disc.material as THREE.MeshBasicMaterial).opacity =
        inside && !calm ? 0.2 + 0.08 * Math.sin(t / 260) : 0.12;
      const acc = live.current.fix?.accuracy ?? 0;
      accRing.group.visible = !!gps;
      accRing.group.position.set(pos.x, 0.5, pos.z);
      accRing.setRadius(Math.min(80, Math.max(3, acc)));
      ripple.update(t, pos.x, pos.z, calmAt(pos.x, pos.z));
      // 거점까지 남은 길: 지금 다리(정문→용봉관 등)에서 캐릭터와 가장 가까운 지점부터
      const leg = world.legs[legOf(seq)];
      dots.mesh.visible = !inside;
      if (!inside)
        dots.update(
          t,
          (s) => pointAlong(leg, s),
          closestAlong(leg, pos.x, pos.z),
          world.legLength[legOf(seq)],
        );

      // 카메라는 사용자가 돌리고 당긴 그대로 캐릭터를 따라가고,
      // 빠르게 걸을수록 조금 물려서 앞길을 더 보여 준다
      follow.set(pos.x, 4, pos.z);
      camera.position.add(offset.subVectors(follow, controls.target));
      controls.target.copy(follow);
      extra +=
        (Math.min(26, Math.max(0, speed - 3) * 1.6) - extra) *
        Math.min(1, dt * 1.5);
      offset.subVectors(camera.position, controls.target);
      offset.setLength(
        Math.max(controls.minDistance, offset.length() - extraShown + extra),
      );
      extraShown = extra;
      camera.position.copy(controls.target).add(offset);
      // 멀리 당길수록 위에서 내려다본다(지도 앱처럼). 안개는 캐릭터까지 거리만큼 밀어 둔다.
      const camD = camera.position.distanceTo(controls.target);
      controls.maxPolarAngle = maxPolarFor(camD);
      controls.update();
      sky.position.copy(camera.position);
      const fog = scene.fog as THREE.Fog,
        f = fogFor(camera.position.distanceTo(controls.target));
      fog.near = f.near;
      fog.far = f.far;
      // 나무·건물·소품의 가까이·멀리 모양은 이번 프레임 카메라로 고른다
      camera.updateMatrixWorld();
      world.update(pos.x, pos.z, camera);

      // 해는 캐릭터 둘레만 그림자를 드리우고, 그림자 지도는 필요할 때만 다시 그린다.
      // 시야 구멍은 카메라와 캐릭터 사이를 막는 것이 있을 때만 연다.
      const shadowFrame = light.follow(pos, camera, moving);
      const cut = updateSeeThrough(camera, pos, dt, scene);
      // 가림이 시작될 때 비침이 툭 나타나지 않게 구멍이 열리는 만큼 서서히 진해진다
      ghost.opacity = ghostOpacity(cut) * Math.min(1, cut / 0.3);
      const showGhost = cut > 0.001;
      if (ghosts[0] && ghosts[0].visible !== showGhost)
        for (const x of ghosts) x.visible = showGhost;
      // 느린 폰에서는 픽셀 비율, 다음은 그림자 크기를 차례로 낮춘다
      if (quality.tick(frameMs)) {
        renderer.setPixelRatio(quality.current.pixelRatio);
        light.setShadowSize(quality.current.shadow);
      }

      // 남은 거리 같은 화면 위 표시는 1초에 네 번만 알린다
      if (t - shown > 250) {
        shown = t;
        live.current.onStatus?.({
          distance: Math.round(remain),
          inRange: inside,
          quiet: quietNow,
          mode: gps ? "gps" : live.current.fix ? "outside" : "demo",
          accuracy: gps ? Math.round(acc) : null,
          loading: false,
          failed: false,
        });
      }
      renderer.render(scene, camera);
      probe?.record(
        renderer,
        shadowFrame,
        {
          frameMs: quality.ema,
          pixelRatio: renderer.getPixelRatio(),
          shadowSize: light.shadowSize,
          level: quality.level,
          cut,
          probeMs: seeThroughProbeMs(),
          x: pos.x,
          z: pos.z,
          camera: camera.position.distanceTo(controls.target),
        },
        t,
      );
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      probe?.dispose();
      // 지도·빛·렌더러는 다음에 이동 화면을 열 때 다시 쓰고, 이번 화면 것만 지운다.
      // 블렌더 모형의 형상·무늬(shared)는 남긴다.
      scene.remove(mount);
      disposeTree(mount);
      renderer.domElement.remove();
      c.onRestore = null;
      releaseCore(c);
    };
  }, [roleColor, role, look, assets, epoch]);
  if (failed) return <>{fallback}</>;
  return (
    <div
      ref={host}
      className="field-3d"
      role="img"
      aria-label={`실제 축척 캠퍼스 지도. ${siteName}까지 걸어가는 내 캐릭터가 보인다`}
    >
      <span className="field-credit">{MAP.credit}</span>
    </div>
  );
}
