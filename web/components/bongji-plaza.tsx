"use client";
// 봉지 마당(hh 2026-11-09, 온라인 산사 참고): 추모의 벽 다음 마지막 거점을 다른 팀과 만나 머무는 곳으로.
// 첫 화면·이동 화면과 같은 점토 캠퍼스(field-3d core)를 화면 전체에 깔고, 봉지 연못가를 자유롭게 걷는다.
// - 바닥을 누르면 내 장병이 그곳으로 걷고(연못·건물은 돌아간다), 끌면 내 둘레를 돌아보고, 두 손가락·휠로 당긴다.
// - 우리 팀과 방문객 모두 가까이 가면 서로 바라보고 오른손 경례를 나눈다.
// - 아래 단추: 경례·사진·종이배·춤추기. 회고와 공동 기록은 종이배 안에서 이어진다. 풍경이 기본 화면이다.
// 점수·시간 제한·경쟁은 없다. 실제 방에서는 우리 팀의 위치·춤·경례를 연결하고, 단독 미리보기만 모의 방문객을 표시한다.
// 자기 효과음이 있는 단추는 data-sound="none"으로 앱 공통 누름 소리(합성 tap)와 겹치지 않게 한다.
// 2026-11-09: 같은 곡의 기본/하우스 편곡이 장소에 따라 이어진다. 선택창 없이 석상 곁에서 춤춘다. 추모의 벽에는 적용하지 않는다.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as THREE from "three";
import { AudioLines, Camera, ChevronDown, Download, Hand, Sailboat, Users, Volume2, VolumeX, X } from "lucide-react";

import { loadFieldAssets, type FieldAssets } from "./field-assets";
import { acquireCore, disposeTree, releaseCore, SKY, type Core } from "./field-3d";
import { campusCollider, moveWithin, type Collider } from "./field-collide";
import type { MapData } from "./field-map";
import { resetSeeThrough } from "./field-occlusion";
import { turnToward } from "./gather-view";
import { HOME } from "./home-view";
import { ROLE_COLORS } from "./role-style";
import { crewSoldier, warmProp, type CrewSoldier } from "./soldier-props";
import { soldierVariant } from "./soldier-variants";
import jnu from "./maps/jnu.json";
import { isMuted, setMuted, subscribeMuted } from "@/lib/sound";
import { createPlazaAudio, type PlazaAudio } from "./bongji-sound";
import { ROLE_NAMES, ROLES, type Role } from "@/supabase/functions/_shared/types";
import { createBongjiStatue, statueNearby, STATUE } from "./bongji-statue";
import { REFLECTION_LIMIT, type PlazaReflection } from "@/lib/bongji-reflection";
import { createDance, danceBubble, type DanceRig } from "./bongji-dance";
import { createSalute, saluteEnvelope, type SaluteRig } from "./bongji-salute";
import { usePlazaSync, type PlazaRoom } from "./use-plaza-sync";
import styles from "./bongji-plaza.module.css";

const MAP = jnu as unknown as MapData;
const BONGJI = MAP.anchors.bongji ?? [138.3, -484];

export const PLAZA = {
  soldierM: HOME.soldierM,
  // 연못 가운데: 봉지 거점 자리에서 조금 비켜(거점 표석이 연못 안에 서지 않게)
  center: { x: BONGJI[0] - 4, z: BONGJI[1] - 12 },
  pond: 9.5, // 연못 반지름(m, 장난감 축척)
  ring: 15, // 처음 선 둘레 반지름(m)
  roam: 34, // 걸어 다닐 수 있는 범위(연못 가운데에서 m)
  speed: { me: 7, guest: 3.4 }, // 걷는 빠르기(m/s)
  near: 10, // 인사를 나눌 수 있는 거리(m)
  photo: 16, // 함께 찍기에 들어오는 거리(m)
  body: 2.3, // 사람끼리 이보다 가까우면 서로 비켜 선다(m)
  cam: { el: 0.72, dist: 52, min: 22, max: 110, az: 0.35, photo: 30 },
  fps: { active: 30, settled: 20 },
  pixelRatio: 1.25,
};

export type PlazaMember = { id: string; nickname: string; role: Role | null; self: boolean; reflected?: boolean };

// 모의 방문객: 다른 두 팀. 이름은 실제 참가자처럼 처음에 직접 정하는 호출명(한글·영문·숫자 1~6자) 모양으로(hh 2026-11-09).
type Visitor = { id: string; nickname: string; role: Role; team: string };
const VISITORS: Visitor[] = [
  { id: "v-2-1", nickname: "하람", role: "commander", team: "2조" },
  { id: "v-2-2", nickname: "은솔", role: "scout", team: "2조" },
  { id: "v-2-3", nickname: "도윤", role: "signal", team: "2조" },
  { id: "v-2-4", nickname: "봄비", role: "cipher", team: "2조" },
  { id: "v-5-1", nickname: "새벽7", role: "scout", team: "5조" },
  { id: "v-5-2", nickname: "지우", role: "commander", team: "5조" },
  { id: "v-5-3", nickname: "moon", role: "cipher", team: "5조" },
];
const TEAMS = ["2조", "5조"] as const;
// 방문객의 배는 접힌 종이배만 보여 준다. 개인 회고 본문은 본인에게만 온다.
const SEED_BOATS = VISITORS.filter((_, i) => i % 2 === 0).map(v => ({
  id: `visitor-${v.id}`, team: v.team, nickname: v.nickname, mine: false, kind: "message" as const, text: "오늘도 수고했어요. 봉지에서 잠깐 쉬어 가요!",
}));

type Panel = null | "boat" | "people" | "photo" | "read";
type Boat = { id: string; team: string; nickname: string; mine: boolean; settled?: boolean; text?: string; kind?: "reflection" | "message"; memberId?: string };
type Cmd = { kind: "statue" } | { kind: "greet" } | { kind: "photo" } | { kind: "boat"; id: string };
type Photo = { url: string; names: string[]; at: string };

const smooth = (x: number) => x * x * (3 - 2 * x);

// 종이배 한 척(점토 톤의 접은 종이)
function paperBoat(color: string) {
  const g = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-1.3, 0.5);
  hullShape.lineTo(1.3, 0.5);
  hullShape.lineTo(0.85, 0);
  hullShape.lineTo(-0.85, 0);
  hullShape.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 0.75, bevelEnabled: false }), paper);
  hull.position.z = -0.375;
  const sail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.15, 4, 1), paper);
  sail.position.y = 1.05;
  sail.rotation.y = Math.PI / 4;
  sail.scale.z = 0.35;
  for (const m of [hull, sail]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

// 돌 등롱(연못가 네 곳)
function stoneLantern() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: "#cfc6b4", roughness: 0.95, flatShading: true });
  const glow = new THREE.MeshStandardMaterial({ color: "#ffe2a8", emissive: "#ffc96b", emissiveIntensity: 0.9 });
  const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
    [new THREE.CylinderGeometry(0.75, 0.9, 0.4, 6), stone, 0.2],
    [new THREE.CylinderGeometry(0.28, 0.34, 1.5, 6), stone, 1.15],
    [new THREE.BoxGeometry(0.95, 0.75, 0.95), glow, 2.25],
    [new THREE.ConeGeometry(0.95, 0.65, 4), stone, 2.95],
  ];
  for (const [geo, mat, y] of parts) {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    if (geo instanceof THREE.ConeGeometry) m.rotation.y = Math.PI / 4;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

let softGL: boolean | null = null;
function softwareGL() {
  if (softGL !== null) return softGL;
  softGL = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "") : "";
    softGL = /swiftshader|llvmpipe|software/i.test(name);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  return softGL;
}
let collider: Collider | null = null;
const campus = () => (collider ??= campusCollider(MAP));

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

export function BongjiPlaza({ members, reflection, room, onRecord, recordContent, recordLabel = "오늘의 실록 보기" }: {
  room?: PlazaRoom;
  members: PlazaMember[];
  reflection: PlazaReflection;
  onRecord?: () => void;
  recordContent?: ReactNode;
  recordLabel?: string;
}) {
  const sync = usePlazaSync(room);
  const syncRef = useRef(sync); syncRef.current = sync;
  const visitors = room ? [] : VISITORS;
  const boatRefs = useRef(new Map<string, HTMLButtonElement>());
  const [readBoat, setReadBoat] = useState<string | null>(null);
  const [messageMode, setMessageMode] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const tagRefs = useRef(new Map<string, HTMLLIElement>());
  const dialogRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  const [assets, setAssets] = useState<FieldAssets | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [teamBoatOpen, setTeamBoatOpen] = useState(false);
  const teamBoatId = useId();
  const [toast, setToast] = useState<string | null>(null);
  const [boats, setBoats] = useState<Boat[]>(() => [...(room ? [] : SEED_BOATS), ...members.filter(m => m.reflected || (m.self && reflection.text)).map(m => ({ id: `reflection-${m.id}`, team: "우리 팀", nickname: m.nickname, mine: m.self, settled: true, memberId:m.id, kind:"reflection" as const, text:m.self ? reflection.text ?? undefined : undefined }))]);
  const [line, setLine] = useState(reflection.text ?? "");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const sendLock = useRef(false);
  const [launchGlow, setLaunchGlow] = useState(false);
  const [dancing, setDancing] = useState(false);
  const [nearStatue, setNearStatue] = useState(false);
  const [toStatue, setToStatue] = useState(false);
  const dancePending = useRef(false);
  const [muted, setMutedState] = useState(false);
  const [hint, setHint] = useState(true);
  const [met, setMet] = useState<string[]>([]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [flash, setFlash] = useState(0);
  const commands = useRef<Cmd[]>([]);
  const live = useRef({ members, boats, panel, dancing });
  live.current = { members, boats, panel, dancing };
  const audio = useRef<PlazaAudio | null>(null);
  // 장면이 알려 주는 결과(인사한 사람, 찍힌 사진)
  const report = useRef({
    greeted: (_id: string | null) => {},
    nearby: (_on: boolean) => {},
    photographed: (_url: string, _ids: string[]) => {},
    readBoat: (_id: string) => {},
  });

  const me = members.find((m) => m.self) ?? members[0];
  const people = room ? sync.online.length + 1 : members.length + visitors.length;
  const selectedBoat = boats.find(b => b.id === readBoat);
  report.current.readBoat = id => { setReadBoat(id);setPanel("read");audio.current?.play("page",.5); };
  const reflectedCount = members.filter(m => m.reflected || (m.self && reflection.text)).length;
  useEffect(() => {
    if (reflection.boats) {
      setBoats(previous => [...(room ? [] : previous.filter(b=>b.team!=="우리 팀")), ...reflection.boats!.map(b=>({ ...b,team:"우리 팀",mine:b.memberId===me?.id,settled:previous.some(p=>p.id===b.id) }))]);
      return;
    }
    setBoats(previous => {
      const fresh = members.filter(m => (m.reflected || (m.self && reflection.text)) && !previous.some(b => m.self ? b.mine : b.id === `reflection-${m.id}`));
      return fresh.length ? [...previous, ...fresh.map(m => ({ id: `reflection-${m.id}`, team: "우리 팀", nickname: m.nickname, mine: m.self, settled: true, memberId:m.id, kind:"reflection" as const, text:m.self ? reflection.text ?? undefined : undefined }))] : previous;
    });
  }, [members, reflection.text, reflection.boats, room?.gameId, me?.id]);
  useEffect(() => { audio.current?.hush(panel === "boat"); }, [panel]);
  useEffect(() => {
    if (!launchGlow) return;
    const timer = window.setTimeout(() => setLaunchGlow(false), 4500);
    return () => window.clearTimeout(timer);
  }, [launchGlow]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.nickname ?? visitors.find((v) => v.id === id)?.nickname ?? "";

  useEffect(() => {
    let gone = false;
    if (softwareGL() && !/[?&]3d=1/.test(window.location.search)) {
      setFailed(true);
      return;
    }
    loadFieldAssets().then((a) => {
      if (gone) return;
      if (!a.soldier) setFailed(true);
      else setAssets(a);
    });
    return () => {
      gone = true;
    };
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 7000);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(0), 700);
    return () => window.clearTimeout(t);
  }, [flash]);

  // 마당의 단일 곡을 재생하는 동안 전역 배경음의 소유권을 잠근다.
  useEffect(() => {
    const a = createPlazaAudio();
    audio.current = a;
    a?.enter();
    return () => {
      a?.dispose();
      audio.current = null;
    };
  }, []);
  // 도착 이야기(나레이션)나 거점 화면이 위를 덮으면 마당 소리를 멈춰 둔다. 덮개가 닫히면 천천히 올린다.
  // (마당은 이야기 뒤에서 먼저 그려지는데, 그동안 곡이 이야기 타자 소리와 겹쳤다 — hh 2026-11-09)
  const covered = useRef(false);
  useEffect(() => {
    const check = () => {
      const on = document.hidden || !!document.querySelector("dialog.narration[open], .stop-screen");
      if (on === covered.current) return;
      covered.current = on;
      audio.current?.cover(on);
    };
    check();
    const iv = window.setInterval(check, 300);
    return () => window.clearInterval(iv);
  }, []);
  useEffect(() => {
    const update = () => setMutedState(isMuted());
    update();
    return subscribeMuted(update);
  }, []);
  const visitStatue = () => {
    if (dancing || toStatue) {
      dancePending.current = false; setDancing(false); setToStatue(false);
      return;
    }
    if (nearStatue) setDancing(true);
    else { dancePending.current = true; commands.current.push({ kind: "statue" }); setToStatue(true); }
  };
  report.current.nearby = (on) => {
    setNearStatue(on);
    audio.current?.setZone(on ? "statue" : "pond");
    if (on) {
      setToStatue(false);
      if (dancePending.current) { setDancing(true); dancePending.current = false; }
    } else setDancing(false);
  };

  report.current.greeted = (id) => {
    if (!id) {
      setToast("충성!");
      return;
    }
    const v = visitors.find((x) => x.id === id);
    setToast(`${v?.team ?? "우리 팀"} ${nameOf(id)} 님, 충성!`);
    setMet((m) => (m.includes(id) ? m : [...m, id]));
  };
  report.current.photographed = (url, ids) => {
    audio.current?.play("shutter", 1);
    setFlash(Date.now());
    setPhoto({ url, names: ids.map(nameOf).filter(Boolean), at: today() });
    window.setTimeout(() => setPanel("photo"), 450);
  };

  // ── 입체 장면 ────────────────────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el || !assets?.soldier) return;
    const gltf = assets.soldier;
    let alive = true,
      frame = 0;
    const cleanups: (() => void)[] = [];

    const start = () => {
      if (!alive) return;
      let core: Core;
      try {
        core = acquireCore(assets);
      } catch {
        setFailed(true);
        return;
      }
      const { renderer, scene, sky, world, light, phone } = core;
      core.onRestore = () => setEpoch((n) => n + 1);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PLAZA.pixelRatio));
      light.setShadowSize(phone ? 512 : 1024);
      light.invalidate();
      resetSeeThrough();
      const col = campus();

      const C = PLAZA.center;
      const mount = new THREE.Group();
      mount.name = "bongji-plaza";
      scene.add(mount);
      mount.add(warmProp());
      const statueAt = { x: C.x + STATUE.offset.x, z: C.z + STATUE.offset.z };
      const statue = createBongjiStatue();
      statue.group.position.set(statueAt.x, .36, statueAt.z);
      mount.add(statue.group);
      let nearStone = false;

      // 연못: 물·돌 테두리·연잎·둘레 마당·등롱
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(PLAZA.pond, 56).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: "#78bfd8", roughness: 0.18, metalness: 0.05 }),
      );
      water.position.set(C.x, 0.34, C.z);
      water.receiveShadow = true;
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(PLAZA.pond + 0.35, 0.55, 6, 56).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: "#d8cfbd", roughness: 0.95, flatShading: true }),
      );
      rim.scale.y = 0.6;
      rim.position.set(C.x, 0.36, C.z);
      rim.castShadow = true;
      rim.receiveShadow = true;
      const pave = new THREE.Mesh(
        new THREE.RingGeometry(PLAZA.pond + 0.8, PLAZA.ring + 4, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: "#e9dcc2", roughness: 1 }),
      );
      pave.position.set(C.x, 0.3, C.z);
      pave.receiveShadow = true;
      mount.add(water, rim, pave);
      const padMat = new THREE.MeshStandardMaterial({ color: "#6f9a58", roughness: 0.8 });
      [[-4.5, 3.2, 1.1], [5.2, -2.4, 0.9], [-2.2, -5.6, 0.8], [3.4, 5.1, 0.7], [6.3, 1.6, 0.6]].forEach(([x, z, r]) => {
        const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 14, 0.4, Math.PI * 2 - 0.4).rotateX(-Math.PI / 2), padMat);
        pad.position.set(C.x + x, 0.37, C.z + z);
        mount.add(pad);
      });
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const l = stoneLantern();
        l.position.set(C.x + Math.sin(a) * (PLAZA.ring + 2.6), 0.3, C.z + Math.cos(a) * (PLAZA.ring + 2.6));
        mount.add(l);
      }
      // 누른 자리 표시(바닥의 얇은 고리, 잠깐 보였다 사라진다)
      const mark = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: "#fffaf0", transparent: true, opacity: 0, depthWrite: false }),
      );
      mark.renderOrder = 3;
      mount.add(mark);
      let markAt = -1e9;

      // 걸을 수 있는 자리로 고친다: 연못 안이면 물가로, 범위 밖이면 안으로
      const fitSpot = (p: { x: number; z: number }) => {
        const dx = p.x - C.x, dz = p.z - C.z, d = Math.hypot(dx, dz) || 1;
        const r = Math.min(PLAZA.roam, Math.max(PLAZA.pond + 1.6, d));
        const spot = { x: C.x + (dx / d) * r, z: C.z + (dz / d) * r };
        const sx=spot.x-statueAt.x, sz=spot.z-statueAt.z, sd=Math.hypot(sx,sz);
        if(sd<STATUE.body+1) {
          const a=sd>.001?Math.atan2(sx,sz):Math.PI;
          spot.x=statueAt.x+Math.sin(a)*(STATUE.body+1);
          spot.z=statueAt.z+Math.cos(a)*(STATUE.body+1);
        }
        return spot;
      };
      const spotAt = (a: number, r = PLAZA.ring) => ({ x: C.x + Math.sin(a) * r, z: C.z + Math.cos(a) * r });
      const front = PLAZA.cam.az; // 처음 카메라가 연못 가운데에서 있는 쪽(rad)

      type Unit = {
        id: string;
        kind: "me" | "team" | "guest";
        team: string;
        s: CrewSoldier;
        pos: THREE.Vector3;
        heading: number;
        target: { x: number; z: number } | null;
        face: number | null; // 서 있을 때 볼 쪽(null이면 그대로)
        speed: number;
        idleUntil: number;
        top: number;
        danceRig: DanceRig | null;
        danceWeight: number;
        danceStarted: number | null;
        saluteRig: SaluteRig | null;
        salute: { at: number; id: string } | null;
        remoteDance: boolean; remoteBeat: number; remoteMoving: boolean; seenSalute: string;
        slot: number; // 팀 안 차례(우리 팀 따라오기 자리)
      };
      const units = new Map<string, Unit>();
      const add = (id: string, role: Role | null, kind: Unit["kind"], team: string, at: { x: number; z: number }, slot: number) => {
        const variant = soldierVariant(id);
        const s = crewSoldier(gltf, { height: PLAZA.soldierM, role: null, variant });
        s.group.children[1].scale.setScalar(0.62);
        s.setRole(role, false);
        s.setCalm(true);
        const heading = Math.atan2(C.x - at.x, C.z - at.z);
        const u: Unit = {
          id, kind, team, s, pos: new THREE.Vector3(at.x, 0.36, at.z), heading, target: null, face: heading,
          speed: kind === "me" ? PLAZA.speed.me : PLAZA.speed.guest, idleUntil: performance.now() + 3000 + Math.random() * 6000,
          top: PLAZA.soldierM * variant.height, danceRig: createDance(s.group), danceWeight: 0, danceStarted: null, saluteRig: null, salute: null, remoteDance:false,remoteBeat:0,remoteMoving:false,seenSalute:"",slot,
        };
        s.group.position.copy(u.pos);
        s.group.rotation.y = heading;
        mount.add(s.group);
        units.set(id, u);
        return u;
      };
      const crew = live.current.members.slice(0, 4);
      const meId = (crew.find((m) => m.self) ?? crew[0])?.id;
      crew.forEach((m, i) => add(m.id, m.role, m.id === meId ? "me" : "team", "우리 팀", spotAt(front + (i - 1.5) * 0.28), i));
      const visitorAngles = [front + 1.98, front + 2.3, front + 2.62, front + 2.94, front - 2.1, front - 2.45, front - 2.8];
      visitors.forEach((v, i) => add(v.id, v.role, "guest", v.team, spotAt(visitorAngles[i]), i));
      const mine = meId ? units.get(meId)! : null;
      // 다른 팀이 모여 거니는 자리(조마다 하나, 가끔 옮긴다)
      // 우리 팀 동료(혼자 시연에서는 시연 동료)도 실제 방처럼 각자 거닌다(내 뒤를 줄지어 따라오면 화면을 가렸다)
      const anchors = new Map<string, { x: number; z: number; until: number }>([
        ...TEAMS.map((t, i) => [t, { ...spotAt(i ? front - 2.45 : front + 2.46, PLAZA.ring + 1), until: performance.now() + 18000 }] as const),
        ["우리 팀", { ...spotAt(front, PLAZA.ring + 1), until: performance.now() + 12000 }] as const,
      ]);

      // 종이배
      type BoatUnit = { g: THREE.Group; r: number; a: number; speed: number; phase: number; born: number };
      const boatUnits = new Map<string, BoatUnit>();
      const syncBoats = (t: number) => {
        const ids = new Set(live.current.boats.map(b => b.id));
        for (const [id, unit] of boatUnits) { if (!ids.has(id)) { unit.g.removeFromParent(); disposeTree(unit.g); boatUnits.delete(id); } }
        live.current.boats.forEach((b, i) => {
          if (boatUnits.has(b.id)) return;
          const g = paperBoat(b.mine ? "#ffd76a" : "#fbf8ef");
          g.scale.setScalar(b.mine ? 1.3 : 1.05);
          mount.add(g);
          // 내 배는 내가 선 쪽 물가에서 떠나 연못 가운데 가까이로 미끄러져 간다
          const myA = mine ? Math.atan2(mine.pos.x - C.x, mine.pos.z - C.z) : front;
          boatUnits.set(b.id, {
            g, r: b.mine ? PLAZA.pond - 1.4 : 3.6 + (i % 3) * 1.7, a: b.mine ? myA : i * 1.7 + 0.6,
            speed: (b.mine ? 0.03 : 0.035 + (i % 2) * 0.015) * (i % 2 ? -1 : 1), phase: i * 1.3, born: b.settled ? -1 : b.mine || b.team === "우리 팀" ? t : -1,
          });
        });
      };

      // 카메라: 내 장병 뒤 위에서 따라간다. 끌면 둘레를 돌고, 두 손가락·휠로 당긴다
      const camera = new THREE.PerspectiveCamera(48, 1, 1, SKY.radius + 20);
      if (process.env.NODE_ENV !== "production")
        (window as unknown as { __plaza?: unknown }).__plaza = { units, camera, get cam() { return cam; } };
      const aim = new THREE.Vector3(mine?.pos.x ?? C.x, 2.4, mine?.pos.z ?? C.z);
      const cam = { az: front, dist: PLAZA.cam.dist, el: PLAZA.cam.el, vel: 0 };
      let viewKey = "";
      const fit = () => {
        const w = el.clientWidth || 1,
          h = el.clientHeight || 1,
          key = `${w}x${h}`;
        if (key === viewKey) return;
        viewKey = key;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.fov = w / h < 0.8 ? 50 : 42;
        camera.updateProjectionMatrix();
      };

      // 누르기와 끌기 구분: 8px 넘게 움직이면 끌기(돌아보기), 아니면 누르기(그곳으로 걷기)
      const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
      let pinch = 0,
        dragged = false;
      const ray = new THREE.Raycaster(),
        ndc = new THREE.Vector2(),
        ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.36),
        hit = new THREE.Vector3();
      const down = (e: PointerEvent) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
        if (pointers.size === 1) dragged = false;
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = Math.hypot(a.x - b.x, a.y - b.y);
          dragged = true;
        }
        el.setPointerCapture?.(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0) cam.dist = THREE.MathUtils.clamp(cam.dist * (pinch / d), PLAZA.cam.min, PLAZA.cam.max);
          pinch = d;
          return;
        }
        if (!dragged && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) dragged = true;
        if (dragged) {
          camGoal = null;
          cam.az -= dx * 0.008;
          cam.vel = -dx * 0.008;
          setHint(false);
        }
      };
      const up = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = 0;
        if (!p || dragged || pointers.size || !mine) return;
        // 먼저 종이배를 고른 뒤 빈 바닥이면 걷는다.
        const r = el.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const boatHit=ray.intersectObjects([...boatUnits.values()].map(b=>b.g),true)[0];
        if(boatHit){const found=[...boatUnits].find(([,b])=>{let o:THREE.Object3D|null=boatHit.object;while(o){if(o===b.g)return true;o=o.parent;}return false;});if(found){report.current.readBoat(found[0]);return;}}
        if (!ray.ray.intersectPlane(ground, hit)) return;
        const to = fitSpot({ x: hit.x, z: hit.z });
        setToStatue(false); setDancing(false); dancePending.current = false;
        mine.target = to;
        mine.face = null;
        mark.position.set(to.x, 0.42, to.z);
        markAt = performance.now();
        setHint(false);
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        cam.dist = THREE.MathUtils.clamp(cam.dist * Math.exp(e.deltaY * 0.0015), PLAZA.cam.min, PLAZA.cam.max);
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("wheel", wheel, { passive: false });
      cleanups.push(() => {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeEventListener("wheel", wheel);
      });

      const saluteUnit = (u: Unit, t: number, delay = 0) => {
        u.saluteRig ??= createSalute(u.s.group, u.top);
        u.salute = { at: t + delay * 1000, id:crypto.randomUUID() };
      };
      const facing = (u: Unit, p: { x: number; z: number }) => Math.atan2(p.x - u.pos.x, p.z - u.pos.z);
      // 우리 팀과 방문객 중 경례를 주고받을 가장 가까운 사람
      const nearest = () => {
        if (!mine) return null;
        let best: Unit | null = null,
          bd = PLAZA.near;
        for (const u of units.values()) {
          if (u.kind === "me" || !u.s.group.visible) continue;
          const d = Math.hypot(u.pos.x - mine.pos.x, u.pos.z - mine.pos.z);
          if (d < bd) [best, bd] = [u, d];
        }
        return best;
      };
      let photoAt = -1,
        photoIds: string[] = [],
        camGoal: { az: number; dist: number; el: number; at?: { x: number; z: number } } | null = null;
      const runCommands = (t: number) => {
        for (const c of commands.current.splice(0)) {
          if (c.kind === "statue" && mine) {
            mine.target = fitSpot({ x: statueAt.x - 6 + (mine.slot % 2)*3.2, z: statueAt.z + 5 + Math.floor(mine.slot/2)*3.2 });
            mine.face = null;
            camGoal = { az: -0.45, dist: 46, el: 0.46 };
          } else if (c.kind === "boat" && mine) {
            mine.target = fitSpot(spotAt(Math.atan2(mine.pos.x-C.x, mine.pos.z-C.z), PLAZA.pond+3));
            mine.face = facing(mine, C);
            camGoal = { az: cam.az, dist: 46, el: .7, at: C };
          } else if (c.kind === "greet") {
            if (mine?.salute) continue;
            const other = nearest();
            if (!mine) continue;
            report.current.greeted(other?.id ?? null);
            mine.target = null;
            if(other)mine.face = facing(mine, other.pos);
            saluteUnit(mine, t, .12);
            if(other && !(room && other.kind === "team")) {
              other.target = null;other.face = facing(other, mine.pos);other.idleUntil = t + 6000;
              saluteUnit(other, t, .7);
            }
          } else if (c.kind === "photo" && mine) {
            // 가까이 있는 사람들이 멈춰 카메라 쪽을 보고, 1.2초 뒤 찍는다
            photoIds = [];
            for (const u of units.values()) {
              if (Math.hypot(u.pos.x - mine.pos.x, u.pos.z - mine.pos.z) > PLAZA.photo) continue;
              if(!u.s.group.visible)continue;
              if(!(room && u.kind==="team")){u.target=null;u.face=facing(u,camera.position);u.idleUntil=t+5000;}
              photoIds.push(u.id);
            }
            // 카메라를 내 앞쪽으로 돌려 얼굴이 보이게 찍는다(뒤에서 찍으면 모자만 보였다)
            // 찍힐 사람이 모두 들어오게: 무리 가운데를 보고, 퍼진 만큼 물러선다
            const ps = photoIds.map((id) => units.get(id)!.pos);
            const at = { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, z: ps.reduce((a, p) => a + p.z, 0) / ps.length };
            const spread = Math.max(0, ...ps.map((p) => Math.hypot(p.x - at.x, p.z - at.z)));
            camGoal = { az: mine.heading, dist: Math.min(PLAZA.cam.max, PLAZA.cam.photo + spread * 2.4), el: 0.32, at };
            for (const id of photoIds) {
              const u = units.get(id)!;
              const cx = mine.pos.x + Math.sin(mine.heading) * 40, cz = mine.pos.z + Math.cos(mine.heading) * 40;
              if(!(room && u.kind==="team"))u.face = Math.atan2(cx - u.pos.x, cz - u.pos.z);
            }
            photoAt = t + 1200;
          }
        }
      };

      // 나 말고는 모두 조 자리 둘레를 거닐다 멈춰 서기를 되풀이한다(조 자리도 가끔 옮긴다)
      let partyOn = false;
      const party = new Set<string>();
      const think = (t: number) => {
        const on = live.current.dancing;
        if(on !== partyOn) {
          partyOn=on;
          if(on) {
            const guests=[...units.values()].filter(u=>u.kind==="guest").sort((a,b)=>a.pos.distanceToSquared(mine?.pos ?? a.pos)-b.pos.distanceToSquared(mine?.pos ?? b.pos)).slice(0,2);
            guests.forEach((u,i)=>{
              party.add(u.id);
              const a=Math.PI*.9+i*.7;
              u.target=fitSpot({x:statueAt.x+Math.sin(a)*7.5,z:statueAt.z+Math.cos(a)*7.5});
              u.face=null;u.idleUntil=t+12000;
            });
          } else {
            for(const id of party) { const u=units.get(id); if(u) u.idleUntil=t+2500; }
            party.clear();
          }
        }
        for (const [team, a] of anchors) {
          if (reduced || t < a.until) continue;
          const ang = Math.random() * Math.PI * 2,
            r = PLAZA.pond + 4 + Math.random() * (PLAZA.roam - PLAZA.pond - 10);
          Object.assign(a, spotAt(ang, r), { until: t + 20000 + Math.random() * 15000 });
          void team;
        }
        for (const u of units.values()) {
          if (u.kind === "me" || (room && u.kind === "team") || reduced || u.target || u.salute || t < u.idleUntil) continue;
          if(live.current.dancing && Math.hypot(u.pos.x-statueAt.x,u.pos.z-statueAt.z)<STATUE.leave) continue;
          const a = anchors.get(u.team)!;
          const ang = Math.random() * Math.PI * 2;
          u.target = fitSpot({ x: a.x + Math.sin(ang) * 3.5, z: a.z + Math.cos(ang) * 3.5 });
          u.face = null;
          u.speed = PLAZA.speed.guest;
          u.idleUntil = t + 5000 + Math.random() * 7000;
        }
      };

      const step = (u: Unit, dt: number) => {
        if (!u.target) return 0;
        const dx = u.target.x - u.pos.x,
          dz = u.target.z - u.pos.z,
          d = Math.hypot(dx, dz);
        if (d < 0.35) {
          u.target = null;
          if (u.kind !== "me") u.face = Math.atan2(C.x - u.pos.x, C.z - u.pos.z);
          return 0;
        }
        const m = Math.min(d, u.speed * dt);
        let nx = u.pos.x + (dx / d) * m,
          nz = u.pos.z + (dz / d) * m;
        // 연못 안으로 들어가지 않게 물가를 따라 미끄러진다
        const px = nx - C.x, pz = nz - C.z, pr = Math.hypot(px, pz);
        const edge = PLAZA.pond + 1.6;
        if (pr < edge) {
          nx = C.x + (px / (pr || 1)) * edge;
          nz = C.z + (pz / (pr || 1)) * edge;
        }
        // 석상 받침을 통과하지 않고 가장자리를 따라 움직인다.
        const sx=nx-statueAt.x, sz=nz-statueAt.z, sd=Math.hypot(sx,sz);
        if(sd<STATUE.body+.8) {
          nx=statueAt.x+sx/(sd||1)*(STATUE.body+.8);
          nz=statueAt.z+sz/(sd||1)*(STATUE.body+.8);
        }
        const to = moveWithin(col, { x: u.pos.x, z: u.pos.z }, { x: nx, z: nz });
        if (to.blocked) {
          u.target = null;
          return 0;
        }
        u.heading = turnToward(u.heading, Math.atan2(dx, dz), dt * 8);
        u.pos.set(to.x, u.pos.y, to.z);
        return u.speed;
      };
      // 사람끼리 겹치지 않게 서로 조금씩 비켜 선다(나는 덜 밀린다)
      const list = [...units.values()];
      const separate = () => {
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if(room && (a.kind === "team" || b.kind === "team"))continue;
            const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
            if (d >= PLAZA.body || d < 1e-3) continue;
            const push = (PLAZA.body - d) / 2, ux = dx / d, uz = dz / d;
            const ka = a.kind === "me" ? 0.2 : 1, kb = b.kind === "me" ? 0.2 : 1;
            a.pos.x -= ux * push * ka;
            a.pos.z -= uz * push * ka;
            b.pos.x += ux * push * kb;
            b.pos.z += uz * push * kb;
          }
      };

      let last = -1,
        shown = false,
        active = true;
      const tagPoint = new THREE.Vector3();
      const draw = (t: number) => {
        const dt = last < 0 ? 0 : Math.min(0.1, (t - last) / 1000);
        last = t;
        fit();
        if(room)for(const u of units.values())if(u.kind==="team"){
          const remote=syncRef.current.peers.current.frames.get(u.id);
          u.s.group.visible=!!remote;u.remoteDance=false;u.remoteMoving=false;
          if(!remote){u.salute=null;u.target=null;continue;}
          const p=remote.frame.pose;
          const age=Math.max(0,Math.min(1500,syncRef.current.clock()-remote.frame.at));
          const k=reduced?1:1-Math.exp(-dt*16);
          u.pos.x+=(C.x+p.x-u.pos.x)*k;u.pos.z+=(C.z+p.z-u.pos.z)*k;
          u.heading=turnToward(u.heading,p.heading,k);u.face=null;u.target=null;
          u.remoteDance=p.dancing;u.remoteMoving=p.moving;u.remoteBeat=p.beat+age/500;
          if(p.salute && u.seenSalute!==p.salute.id){
            u.seenSalute=p.salute.id;
            const elapsed=syncRef.current.clock()-p.salute.at;
            if(elapsed<2100&&elapsed>-1000){u.saluteRig??=createSalute(u.s.group,u.top);u.salute={id:p.salute.id,at:t-elapsed};}
          }
        }
        runCommands(t);
        think(t);
        syncBoats(t);
        let moving = false;
        for (const u of units.values()) {
          const speed = room && u.kind === "team" ? (u.remoteMoving ? PLAZA.speed.me : 0) : step(u, dt);
          if (speed) moving = true;
          else if (u.face !== null) u.heading = turnToward(u.heading, u.face, reduced ? 1 : dt * 3);
        }
        separate();
        if (mine) {
          const on=statueNearby(Math.hypot(mine.pos.x-statueAt.x,mine.pos.z-statueAt.z),nearStone);
          if(on!==nearStone) { nearStone=on; report.current.nearby(on); }
        }
        const beat=audio.current?.beat ?? t / 500;
        const phase=(beat % 1 + 1) % 1;
        const beatOn=live.current.dancing && !covered.current;
        statue.update(nearStone && !covered.current,phase,reduced);
        for (const u of units.values()) {
          u.s.group.position.copy(u.pos);
          u.s.group.rotation.y = u.heading;
          u.s.group.rotation.z = 0;
          const remote=!!room && u.kind==="team";
          const unitBeat=remote?u.remoteBeat:beat;
          const wantsDance = (remote ? u.remoteDance : beatOn && (u.kind !== "me" || live.current.dancing)
            && Math.hypot(u.pos.x-statueAt.x,u.pos.z-statueAt.z)<STATUE.leave && !u.target && photoAt<0) && !u.salute;
          if (wantsDance && u.danceStarted === null) u.danceStarted = unitBeat;
          else if (!wantsDance) u.danceStarted = null;
          u.danceWeight += ((wantsDance && !reduced ? 1 : 0) - u.danceWeight) * Math.min(1, dt * 7);
          u.danceRig?.restore();
          u.saluteRig?.restore();
          u.s.animate(dt, remote ? u.remoteMoving : !!u.target, remote ? (u.remoteMoving?PLAZA.speed.me:0) : u.target ? u.speed : 0);
          if (u.danceWeight > .005 && !u.salute) {
            const offset = u.danceRig?.apply(unitBeat, u.danceWeight, u.slot) ?? 0;
            u.s.group.position.x += Math.cos(u.heading) * offset;
            u.s.group.position.z -= Math.sin(u.heading) * offset;
            moving = true;
          }
          if (u.salute) {
            const elapsed = (t - u.salute.at) / 1000;
            u.saluteRig?.apply(saluteEnvelope(elapsed, reduced));
            moving = true;
            if (elapsed >= 2.1) u.salute = null;
          }

        }
        if(mine && room)syncRef.current.send.current?.({
          x:Math.round((mine.pos.x-C.x)*1000)/1000,z:Math.round((mine.pos.z-C.z)*1000)/1000,
          heading:Math.round(mine.heading*1000)/1000,moving:!!mine.target,
          dancing:live.current.dancing && !mine.target && !mine.salute && !covered.current,
          beat:live.current.dancing?beat:0,
          salute:mine.salute?{id:mine.salute.id,at:Math.round(syncRef.current.clock()+mine.salute.at-t)}:null,
        });
        // 종이배
        for (const b of boatUnits.values()) {
          const age = (t - b.born) / 1000;
          const r = b.born < 0 ? b.r : b.r + (1.8 - b.r) * smooth(Math.min(1, Math.max(0, age) / 8));
          if (!reduced) b.a += b.speed * dt;
          b.g.position.set(C.x + Math.sin(b.a) * r, 0.42 + (reduced ? 0 : Math.sin(t / 900 + b.phase) * 0.06), C.z + Math.cos(b.a) * r);
          b.g.rotation.y = b.a + (b.speed > 0 ? 0 : Math.PI);
          b.g.rotation.z = reduced ? 0 : Math.sin(t / 1100 + b.phase) * 0.06;
        }
        // 누른 자리 고리: 0.9초 동안 퍼지며 사라진다
        const mk = (t - markAt) / 900;
        (mark.material as THREE.MeshBasicMaterial).opacity = mk < 1 ? 0.85 * (1 - mk) : 0;
        mark.scale.setScalar(1 + Math.min(1, Math.max(0, mk)) * 0.6);
        // 카메라: 내 장병을 부드럽게 따라간다. 끌기를 놓으면 천천히 멈춘다
        const focus = camGoal?.at ?? (mine ? mine.pos : null);
        if (focus) aim.lerp(tagPoint.set(focus.x, 2.4 + (PLAZA.cam.el - cam.el) * 4, focus.z), reduced ? 1 : 1 - Math.exp(-dt * 4));
        if (!pointers.size) {
          cam.az += cam.vel;
          cam.vel *= 0.88;
        }
        if (camGoal) {
          // 가장 짧은 쪽으로 돈다
          let d = camGoal.az - cam.az;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
          cam.az += d * k;
          cam.dist += (camGoal.dist - cam.dist) * k;
          cam.el += (camGoal.el - cam.el) * k;
          if (Math.abs(d) < 0.01 && Math.abs(camGoal.dist - cam.dist) < 0.2 && photoAt < 0) camGoal = null;
        }
        const el2 = cam.el;
        camera.position.set(
          aim.x + Math.sin(cam.az) * Math.cos(el2) * cam.dist,
          aim.y + Math.sin(el2) * cam.dist,
          aim.z + Math.cos(cam.az) * Math.cos(el2) * cam.dist,
        );
        camera.lookAt(aim);
        sky.position.copy(camera.position);
        const fog = scene.fog as THREE.Fog;
        fog.near = cam.dist + HOME.fog.near;
        fog.far = Math.max(fog.near + 60, HOME.fog.far);
        camera.updateMatrixWorld();
        world.update(aim.x, aim.z, camera);
        light.follow(new THREE.Vector3(aim.x, 0, aim.z), camera, moving);
        renderer.render(scene, camera);
        // 함께 찍기: 그린 바로 뒤에 화면을 사진으로 뜬다(이름표는 화면 위 글이라 사진에 들어가지 않는다)
        // 카메라가 앞으로 다 돌고 모두 돌아선 뒤에 찍는다(느린 기기에서도). 3.5초가 지나면 그대로 찍는다
        const posed = !camGoal || Math.abs(Math.atan2(Math.sin(camGoal.az - cam.az), Math.cos(camGoal.az - cam.az))) < 0.05;
        const turned = photoIds.every((id) => {
          const u = units.get(id);
          return !u || u.face === null || Math.abs(Math.atan2(Math.sin(u.face - u.heading), Math.cos(u.face - u.heading))) < 0.12;
        });
        if (photoAt > 0 && t >= photoAt && ((posed && turned) || t >= photoAt + 2300)) {
          photoAt = -1;
          try {
            report.current.photographed(renderer.domElement.toDataURL("image/jpeg", 0.86), photoIds);
          } catch {}
          camGoal = { az: cam.az, dist: PLAZA.cam.dist, el: PLAZA.cam.el };
        }
        active = moving || pointers.size > 0 || Math.abs(cam.vel) > 1e-4 || mk < 1 || photoAt > 0 || !!camGoal;
        // 머리 위 이름표(인사를 나눌 수 있는 가장 가까운 사람은 밝게)
        const w = el.clientWidth || 1,
          h = el.clientHeight || 1,
          near = nearest();
        for (const u of units.values()) {
          const tag = tagRefs.current.get(u.id);
          if (!tag) continue;
          tagPoint.set(u.pos.x, u.top * 1.04, u.pos.z).project(camera);
          const x = ((tagPoint.x + 1) / 2) * w,
            y = ((1 - tagPoint.y) / 2) * h;
          tag.dataset.member = u.id;
          tag.dataset.dancing = u.danceWeight > .6 ? "1" : "0";
          tag.dataset.online = u.s.group.visible ? "1" : "0";
          tag.style.opacity = u.s.group.visible && tagPoint.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20 ? "1" : "0";
          tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
          tag.style.zIndex = String(Math.round((1 - tagPoint.z) * 1e4));
          tag.dataset.chat = u.danceWeight > .6 && !u.salute && !reduced ? danceBubble((room && u.kind==="team"?u.remoteBeat:beat) - (u.danceStarted ?? beat), u.slot) : "";
          tag.dataset.salute = u.salute && t >= u.salute.at && t < u.salute.at + 1750 ? "1" : "0";
          tag.dataset.near = near?.id === u.id ? "1" : "0";
        }
        for(const [id,b] of boatUnits){
          const button=boatRefs.current.get(id);if(!button)continue;
          tagPoint.copy(b.g.position).add(new THREE.Vector3(0,.8,0)).project(camera);
          const x=(tagPoint.x+1)/2*w,y=(1-tagPoint.y)/2*h;
          button.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
          button.style.visibility=tagPoint.z<1 && x>0 && x<w && y>0 && y<h?"visible":"hidden";
        }
        if (markRef.current) markRef.current.dataset.near = near ? "1" : "0";
        if (!shown) {
          shown = true;
          setReady(true);
        }
      };

      let prev = -Infinity;
      const loop = (t: number) => {
        frame = 0;
        if (!alive || document.hidden || core.lost) return;
        frame = requestAnimationFrame(loop);
        if (live.current.panel && shown && !active && t - prev < 100) return;
        if (covered.current && shown && t - prev < 500) return;
        const rate = active ? PLAZA.fps.active : PLAZA.fps.settled;
        if (t - prev < (reduced ? 250 : 1000 / rate - 2)) return;
        prev = t;
        draw(t);
      };
      const wake = () => {
        if (!alive || document.hidden || frame) return;
        last = -1;
        frame = requestAnimationFrame(loop);
      };
      document.addEventListener("visibilitychange", wake);
      el.prepend(renderer.domElement);
      fit();
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
        scene.remove(mount);
        disposeTree(mount);
        renderer.domElement.remove();
        core.onRestore = null;
        releaseCore(core);
      });
    };
    const idle = "requestIdleCallback" in window ? window.requestIdleCallback(start, { timeout: 400 }) : 0;
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

  // ── 단추 동작 ────────────────────────────────────────────
  const open = (next: Exclude<Panel, null | "photo">) => {
    audio.current?.play("page", 0.7);
    if (next === "boat") { setTeamBoatOpen(members.length > 0 && reflectedCount === members.length); const message=!!reflection.text || !!reflection.closed;setMessageMode(message);setLine(message?"":reflection.text??line);setSendError(""); }
    setPanel(next);
  };
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const controls = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])].filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sendLock.current) { e.preventDefault(); setPanel(null); }
      if (e.key !== "Tab") return;
      const all = controls(), first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus({ preventScroll: true }); };
  }, [panel]);
  const launch = async () => {
    const text = line.trim();
    const submit=messageMode?reflection.onMessage:reflection.onSend;
    if (!text || text.length > REFLECTION_LIMIT || !me || (!messageMode && reflection.closed) || !submit || sendLock.current || reflection.busy) return;
    sendLock.current = true; setSending(true); setSendError("");
    try {
      if (!await submit(text)) { setSendError("아직 저장하지 못했어요. 적은 글은 그대로 있으니 다시 보내 주세요."); return; }
      const boatId = `reflection-${me.id}`;
      commands.current.push({ kind: "boat", id: boatId });
      if(!messageMode)setBoats(previous => [...previous.filter(b => b.id!==boatId), { id: boatId, team: "우리 팀", nickname: me.nickname, mine: true,memberId:me.id,text,kind:"reflection" }]);
      setPanel(null); setLaunchGlow(true); setDancing(false);
      audio.current?.play("boat", .8);
      setToast(reflection.preview ? "종이배를 띄웠어요 · 미리보기 저장" : "종이배를 띄웠어요");
    } catch { setSendError("연결을 확인한 뒤 다시 보내 주세요. 적은 글은 남아 있어요."); }
    finally { sendLock.current = false; setSending(false); }
  };


  return (
    <section className={styles.root} data-testid="bongji-plaza" data-connection={room ? (sync.connected ? "live" : "connecting") : "preview"} data-music-zone={nearStatue ? "statue" : "pond"} data-state={failed ? "flat" : ready ? "3d" : "loading"}>
      <div className={styles.poster} aria-hidden="true"><span className={styles.posterPond} /></div>
      {!failed && <div ref={host} className={`${styles.three} ${ready ? styles.shown : ""}`} aria-hidden="true" />}
      {!failed && ready && (
        <ol className={styles.tags} aria-hidden="true">
          {members.slice(0, 4).map((m) => (
            <li key={m.id} ref={(n) => { if (n) tagRefs.current.set(m.id, n); else tagRefs.current.delete(m.id); }}
              className={`${styles.tag} ${m.self ? styles.me : ""}`}
              style={m.role ? ({ "--role": ROLE_COLORS[m.role] } as CSSProperties) : undefined}>
              {m.nickname}{m.self && <small>나</small>}
            </li>
          ))}
          {visitors.map((v) => (
            <li key={v.id} ref={(n) => { if (n) tagRefs.current.set(v.id, n); else tagRefs.current.delete(v.id); }}
              className={`${styles.tag} ${styles.guest}`} style={{ "--role": ROLE_COLORS[v.role] } as CSSProperties}>
              {v.nickname}{met.includes(v.id) && <i aria-hidden="true">✓</i>}
            </li>
          ))}
        </ol>
      )}
      <div className={styles.boatTargets} data-flat={failed} inert={panel!==null}>
        {boats.filter(b=>b.text).map(b=><button type="button" key={b.id} className={styles.boatTarget} data-sound="none" aria-label={`${b.nickname}의 ${b.kind==="message"?"메시지":"회고"} 종이배 읽기`} title={`${b.nickname}의 종이배`} ref={n=>{if(n)boatRefs.current.set(b.id,n);else boatRefs.current.delete(b.id);}} onClick={()=>report.current.readBoat(b.id)}><span>읽기</span></button>)}
      </div>
      {launchGlow && <span className={styles.launchNote} role="status">접어 보낸 오늘, 오래 기억할게요.</span>}
      {flash > 0 && <span className={styles.flash} aria-hidden="true" />}

      <div className={styles.top} inert={panel !== null}>
        <button type="button" data-sound="none" className={styles.presence} onClick={() => open("people")}
          aria-label={`봉지 마당, ${people}명이 머무는 중. 함께 있는 사람 보기`}>
          <Users size={15} aria-hidden="true" />
          <span><b>봉지 마당</b> · {room ? "우리 팀" : "3팀"} {people}명</span>
          {!room && <i className={styles.demo}>시연</i>}
          {room && !sync.connected && <i className={styles.demo}>연결 중</i>}
        </button>
        <button type="button" className={styles.soundToggle} data-sound="none" aria-label={muted ? "소리 켜기" : "소리 끄기"} aria-pressed={!muted} onClick={() => { setMuted(!isMuted()); audio.current?.enter(); }}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
      {hint && ready && <p className={styles.hint} aria-hidden="true">이제 자유롭게 쉬어가요 · 바닥을 누르면 걸어요</p>}
      {toast && <p className={styles.toast} role="status">{toast}</p>}

      {panel && (
        <div ref={dialogRef} className={styles.focus} role="dialog" aria-modal="true"
          aria-label={{ boat: "종이배 띄우기", people: "함께 있는 사람", photo: "함께 찍은 사진", read:"종이배 읽기" }[panel]}>
          <button type="button" className={styles.close} onClick={() => setPanel(null)} disabled={sending} aria-label="닫기"><X size={18} /></button>
          {panel === "read" && selectedBoat && <article className={`${styles.card} ${styles.readCard}`}>
            <Sailboat size={34} aria-hidden="true" />
            <span className={styles.eyebrow}>{selectedBoat.kind==="message"?"물결 따라 도착한 말":"종이배에 남긴 회고"}</span>
            <h3>{selectedBoat.nickname}의 종이배</h3>
            <p className={styles.boatLetter}>{selectedBoat.text}</p>
            <button type="button" className="button primary full" onClick={()=>open("boat")}>나도 종이배 보내기</button>
            {selectedBoat.mine && selectedBoat.kind==="reflection" && !reflection.closed && <button type="button" className="button secondary full" onClick={()=>{setMessageMode(false);setLine(reflection.text??"");setPanel("boat");}}>회고 고쳐쓰기</button>}
          </article>}
          {panel === "boat" && (
            <div className={`${styles.card} ${styles.reflectionCard}`}>
            <form className={styles.boatForm} data-testid="reflection-boat" onSubmit={e => { e.preventDefault(); void launch(); }}>
              <svg className={styles.boatArt} viewBox="0 0 120 70" aria-hidden="true">
                <path d="M10 40 L110 40 L92 60 L28 60 Z" fill="#f7e7b8" stroke="#61745f" strokeWidth="2" strokeLinejoin="round" />
                <path d="M60 6 L84 40 L36 40 Z" fill="#fffdf6" stroke="#61745f" strokeWidth="2" strokeLinejoin="round" />
                <path d="M60 6 L60 40" stroke="#61745f" strokeWidth="1.5" />
              </svg>
              <span className={styles.eyebrow}>오늘의 마음을 접어</span>
              <h3>{messageMode ? "종이배에 전할 말" : reflection.text ? "종이배에 남긴 회고" : "회고를 종이배에 담아요"}</h3>
              <p className={styles.fine}>{messageMode ? "함께 있는 동료에게 한마디 남겨 보세요." : reflection.prompt || "오늘 함께 걸으며 마음에 남은 순간은 무엇인가요?"}</p>
              <label className={styles.reflectionLabel}>
                <span>{messageMode?"전할 말":"나의 회고"}</span>
                <textarea className={styles.input} value={line} maxLength={REFLECTION_LIMIT} rows={5}
                  readOnly={!messageMode && reflection.closed} disabled={sending || reflection.busy}
                  onChange={e => setLine(e.target.value)} placeholder="기억하고 싶은 장면, 동료에게 고마웠던 마음…" aria-label={messageMode?"종이배에 담을 메시지":"종이배에 담을 회고"} />
              </label>
              <div className={styles.reflectionMeta}><span>{line.length} / {REFLECTION_LIMIT}</span></div>
              {sendError && <p className={styles.sendError} role="alert">{sendError}</p>}
              {(messageMode || !reflection.closed) && <button className="button primary full" data-sound="none" disabled={!line.trim() || sending || reflection.busy || !(messageMode?reflection.onMessage:reflection.onSend)}>
                {sending ? "마음을 접는 중…" : messageMode ? "메시지를 담아 띄우기" : reflection.text ? "고쳐 적어 다시 띄우기" : "회고를 담아 띄우기"}
              </button>}
            </form>
            {recordContent && <section className={styles.teamBoat}>
              <button type="button" className={styles.teamBoatToggle} aria-expanded={teamBoatOpen} aria-controls={teamBoatId} onClick={() => setTeamBoatOpen(!teamBoatOpen)}>
                <span>우리 팀 종이배 <small>{reflectedCount} / {members.length}척</small></span>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              <div id={teamBoatId} hidden={!teamBoatOpen}>{recordContent}</div>
            </section>}
            {onRecord && <button type="button" className="button secondary full" onClick={onRecord}>{recordLabel}</button>}
            </div>
          )}
          {panel === "people" && (
            <div className={styles.card}>
              <h3>지금 봉지에 있는 사람</h3>
              {!room && <p className={styles.fine}>다른 팀은 시연용 방문객이에요.</p>}
              <dl className={styles.people}>
                <dt>우리 팀</dt>
                <dd>{members.map((m) => `${m.nickname}${met.includes(m.id) ? " ✓" : ""}${m.role ? `(${ROLE_NAMES[m.role]})` : ""}`).join(" · ")}</dd>
                {(room ? [] : TEAMS).map((team) => (
                  <div key={team}>
                    <dt>{team}</dt>
                    <dd>{VISITORS.filter((v) => v.team === team).map((v) => `${v.nickname}${met.includes(v.id) ? " ✓" : ""}`).join(" · ")}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.fine}>✓ 경례를 나눈 사람 {met.length}명</p>
            </div>
          )}
          {panel === "photo" && photo && (
            <div className={styles.card}>
              <figure className={styles.polaroid}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={`봉지 마당에서 함께 찍은 사진: ${photo.names.join(", ")}`} />
                <figcaption>
                  <b>봉지에서 · {photo.at}</b>
                  <span>{photo.names.length > 1 ? `${photo.names.join(" · ")}` : "혼자 남긴 한 장"}</span>
                </figcaption>
              </figure>
              <a className="button primary full" href={photo.url} download={`봉지마당-${photo.at}.jpg`}>
                <Download size={16} /> 사진 저장
              </a>
            </div>
          )}
        </div>
      )}

      <nav inert={panel !== null} className={styles.dock} aria-label="봉지 마당에서 할 수 있는 것">
        <button type="button" data-sound="none" ref={markRef} className={styles.greet} onClick={() => commands.current.push({ kind: "greet" })} disabled={!ready}>
          <Hand size={20} aria-hidden="true" /><span>경례</span>
        </button>
        <button type="button" data-sound="none" onClick={() => commands.current.push({ kind: "photo" })} disabled={!ready} aria-label="함께 찍기">
          <Camera size={20} aria-hidden="true" /><span>사진</span>
        </button>
        <button type="button" data-sound="none" className={styles.boatAction} onClick={() => open("boat")} aria-label={reflection.text ? "새 메시지 종이배 띄우기" : "회고 종이배 띄우기"}><Sailboat size={20} aria-hidden="true" /><span>종이배</span></button>
        <button type="button" data-sound="none" onClick={visitStatue} disabled={!ready || toStatue} aria-pressed={dancing || toStatue} aria-label={dancing ? "춤 멈추기" : toStatue ? "석상으로 이동 중" : "석상 곁에서 춤추기"}><AudioLines size={20} aria-hidden="true" /><span>{dancing ? "쉬기" : toStatue ? "가는 중" : "춤추기"}</span></button>
      </nav>
    </section>
  );
}

/** 혼자 시연·개발 화면용: 우리 팀 네 사람(보직이 정해진 모습) */
export function demoPlazaMembers(selfRole: Role = "commander"): PlazaMember[] {
  const names: Record<Role, string> = { commander: "기록자", scout: "솔빛", signal: "너울", cipher: "가람" };
  return ROLES.map((r) => ({ id: `demo-${r}`, nickname: names[r], role: r, self: r === selfRole }));
}
