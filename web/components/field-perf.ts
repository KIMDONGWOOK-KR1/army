import type * as THREE from "three";

// 필드 성능: 느린 폰에서 화질을 차례로 낮추는 적응 화질과, 개발용 renderer.info 기록.
//
// 적응 화질: 프레임 시간(지수 평균)이 22ms를 2초 넘게 넘으면 한 단계 내린다
// (픽셀 비율 1.75 → 1.4 → 1.1, 다음은 그림자 지도 1024 → 512, 마지막은 그림자 끄기).
// 18ms 아래(60fps)가 8초 이어지면 한 단계 올리고, 다시 내려갈 때마다 올리는 데 드는
// 시간을 두 배로 늘려 오르내림을 되풀이하지 않는다. 주소에 ?fq=0(가장 좋은 화질)~
// 처럼 단계를 적으면 그 단계로 고정한다(시연·화면 확인용).

export type QualityLevel = { pixelRatio: number; shadow: number };

export const QUALITY = {
  maxPixelRatio: 1.75,
  ratios: [1.75, 1.4, 1.1],
  slowMs: 22,
  fastMs: 18,
  degradeAfter: 2, // 초
  recoverAfter: 8, // 초
  warmup: 1.5, // 화면을 연 뒤 이만큼(초)은 재지 않는다(셰이더 컴파일 등)
  settle: 1, // 단계를 바꾼 뒤 이만큼(초)은 재지 않는다
  outlierMs: 1000, // 이보다 긴 프레임(탭 전환 등)은 빼고 잰다. 평균에는 100ms까지만 넣는다
};

// 기기에 맞는 화질 단계들(0이 가장 좋다). 같은 단계는 하나로 합친다.
export function qualityLevels(dpr: number, phone: boolean): QualityLevel[] {
  const top = phone ? 1024 : 2048,
    out: QualityLevel[] = [];
  const push = (l: QualityLevel) => {
    const p = out[out.length - 1];
    if (!p || p.pixelRatio !== l.pixelRatio || p.shadow !== l.shadow)
      out.push(l);
  };
  for (const r of QUALITY.ratios)
    push({ pixelRatio: Math.min(dpr, r), shadow: top });
  const low = out[out.length - 1].pixelRatio;
  for (let s = top / 2; s >= 512; s /= 2) push({ pixelRatio: low, shadow: s });
  push({ pixelRatio: low, shadow: 0 });
  return out;
}

export class AdaptiveQuality {
  level: number;
  ema = 16.7;
  private slow = 0;
  private fast = 0;
  private quiet: number;
  private backoff = 1;
  constructor(
    readonly levels: QualityLevel[],
    readonly pinned: number | null = null,
    start = 0,
  ) {
    this.level = Math.min(levels.length - 1, Math.max(0, pinned ?? start));
    this.quiet = QUALITY.warmup;
  }
  get current() {
    return this.levels[this.level];
  }
  // 화면을 다시 열었을 때: 단계는 그대로 두고 재는 것만 다시 시작한다
  restart() {
    this.quiet = QUALITY.warmup;
    this.slow = this.fast = 0;
  }
  // 프레임마다 지난 프레임 시간(ms)을 넣는다. 단계가 바뀌었으면 true.
  tick(frameMs: number): boolean {
    if (!(frameMs > 0) || frameMs > QUALITY.outlierMs) return false;
    const dt = Math.min(frameMs, 250) / 1000,
      ms = Math.min(frameMs, 100);
    this.ema += (ms - this.ema) * Math.min(1, dt / 0.5);
    if (this.pinned !== null) return false;
    if (this.quiet > 0) {
      this.quiet -= dt;
      return false;
    }
    this.slow = this.ema > QUALITY.slowMs ? this.slow + dt : 0;
    this.fast = this.ema < QUALITY.fastMs ? this.fast + dt : 0;
    if (
      this.slow > QUALITY.degradeAfter &&
      this.level < this.levels.length - 1
    ) {
      this.level++;
      this.backoff *= 2;
      return this.changed();
    }
    if (this.fast > QUALITY.recoverAfter * this.backoff && this.level > 0) {
      this.level--;
      return this.changed();
    }
    return false;
  }
  private changed() {
    this.slow = this.fast = 0;
    this.quiet = QUALITY.settle;
    return true;
  }
}

// 주소의 ?fq=N(화질 고정)과 ?dev=1(기록 켜기)을 읽는다
export function fieldFlags(search: string) {
  const q = new URLSearchParams(search),
    fq = q.get("fq");
  return {
    pinned: fq !== null && /^\d+$/.test(fq) ? Number(fq) : null,
    dev: q.get("dev") === "1",
  };
}

// 개발용 기록: window.__fieldStats에 마지막 값을 두고 2초마다 콘솔에 한 줄 남긴다.
// 그림자 지도를 다시 그린 프레임과 아닌 프레임의 renderer.info를 따로 모아
// 주 패스와 그림자 패스를 나눈다(그림자를 그린 프레임 = 주 패스 + 그림자 패스).
export type FieldStats = {
  calls: number; // 주 패스 드로콜
  triangles: number; // 주 패스 삼각형
  shadowCalls: number;
  shadowTriangles: number;
  frameMs: number;
  pixelRatio: number;
  shadowSize: number;
  level: number;
  cut: number;
  probeMs: number; // 마지막 가림 검사(CPU) 시간
  geometries: number;
  textures: number;
  programs: number;
  x: number;
  z: number;
  camera: number;
};

declare global {
  interface Window {
    __fieldStats?: FieldStats;
    // ?dev=1일 때만: 빛·장면을 브라우저 콘솔에서 살펴보고 맞춰 볼 수 있게 둔다
    __field?: Record<string, unknown>;
  }
}

export function statsProbe() {
  const s: FieldStats = {
    calls: 0,
    triangles: 0,
    shadowCalls: 0,
    shadowTriangles: 0,
    frameMs: 0,
    pixelRatio: 0,
    shadowSize: 0,
    level: 0,
    cut: 0,
    probeMs: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    x: 0,
    z: 0,
    camera: 0,
  };
  let logged = 0;
  window.__fieldStats = s;
  return {
    // 렌더한 바로 뒤에 부른다
    record(
      renderer: THREE.WebGLRenderer,
      shadowFrame: boolean,
      o: Pick<
        FieldStats,
        | "frameMs"
        | "pixelRatio"
        | "shadowSize"
        | "level"
        | "cut"
        | "probeMs"
        | "x"
        | "z"
        | "camera"
      >,
      t: number,
    ) {
      const r = renderer.info.render;
      if (shadowFrame) {
        s.shadowCalls = Math.max(0, r.calls - s.calls);
        s.shadowTriangles = Math.max(0, r.triangles - s.triangles);
      } else {
        s.calls = r.calls;
        s.triangles = r.triangles;
      }
      Object.assign(s, o);
      s.geometries = renderer.info.memory.geometries;
      s.textures = renderer.info.memory.textures;
      s.programs = renderer.info.programs?.length ?? 0;
      if (t - logged > 2000) {
        logged = t;
        console.info(
          "field stats",
          JSON.stringify({
            ...s,
            frameMs: Math.round(s.frameMs * 10) / 10,
            cut: Math.round(s.cut * 100) / 100,
            probeMs: Math.round(s.probeMs * 100) / 100,
            x: Math.round(s.x),
            z: Math.round(s.z),
            camera: Math.round(s.camera),
          }),
        );
      }
    },
    dispose() {
      if (window.__fieldStats === s) delete window.__fieldStats;
      delete window.__field;
    },
  };
}
