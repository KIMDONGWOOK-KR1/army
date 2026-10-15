// 호국실록 캠퍼스 사운드(음원 파일) 재생. public/sound/의 mp3 9개를 장면에 맞춰 튼다.
// 파일을 못 불러오면 lib/sound.ts가 지금까지의 합성 배경음·효과음으로 대신 낸다.
//
// - 반복 곡(01·03·04·05·08)은 한 번 디코딩해 AudioBufferSourceNode loop로 튼다. 반복 끝점은
//   manifest 길이(seconds)에 맞춘다(디코더가 끝에 덧붙인 표본이 있어도 틈 없이 돈다).
// - 장면이 바뀌면 기존 곡은 0.6초 동안 내리고, 새 곡은 처음부터 1.5초 동안 올린다.
//   화면은 음악을 기다리지 않는다(불러오는 중이면 다 받은 뒤에 올라온다).
// - 단발 곡(02·06·07·09)은 앞을 자르거나 페이드하지 않고, 배경음만 잠깐 낮춘다.
// - 처음에는 01·02만 받고, 나머지는 지금 곡의 다음 단계 곡을 미리 받아 둔다(NEXT).
//   디코딩한 소리는 지금 곡과 다음 단계 곡만 남기고 버린다(폰 메모리).
// - 사파리 엔진(웹킷, 아이폰의 모든 브라우저)은 mp3 앞의 인코더 지연을 지우지 않아 반복 이음매에 틈·딸깍이
//   생긴다(2026-10-10 측정: 01·03·05·08). 이 곡들은 웹킷에서만 같은 길이의 16비트 WAV를 받는다(webkitWav).
// 표는 public/sound/manifest.json과 같아야 한다(tests/sound-files.test.ts가 맞춰 본다).

export const TRACKS = {
  "01": { file: "hoguk-01-lobby.mp3", seconds: 80, loop: true, webkitWav: true },
  "02": { file: "hoguk-02-role-reveal.mp3", seconds: 6.8, loop: false },
  "03": { file: "hoguk-03-walk.mp3", seconds: 96, loop: true, webkitWav: true },
  "04": { file: "hoguk-04-mission.mp3", seconds: 80, loop: true },
  "05": { file: "hoguk-05-memorial.mp3", seconds: 72, loop: true, webkitWav: true },
  "06": { file: "hoguk-06-silence.mp3", seconds: 10, loop: false },
  "07": { file: "hoguk-07-record.mp3", seconds: 3.6, loop: false },
  "08": { file: "hoguk-08-bongji.mp3", seconds: 80, loop: true, webkitWav: true },
  "09": { file: "hoguk-09-results.mp3", seconds: 24, loop: false },
} as const;
export type Track = keyof typeof TRACKS;
export type LoopTrack = "01" | "03" | "04" | "05" | "08";
export type CueTrack = "02" | "06" | "07" | "09";
export const SOUND_BASE = "/sound/";
export const FIRST: Track[] = ["01", "02"];
// 지금 곡 다음에 올 수 있는 곡(한 단계 앞에서 미리 받는다)
export const NEXT: Record<Track, Track[]> = {
  "01": ["02", "03"],
  "02": ["03"],
  "03": ["04", "05"],
  "04": ["07", "03", "05"],
  "05": ["06", "07", "03", "08"],
  "06": ["07"],
  "07": ["03", "05", "08"],
  "08": ["09"],
  "09": [],
};
// hh 2026-10-11: 미션 곡(04)이 문제 풀 때 거슬린다 → 크기를 줄인다. 바람·침묵(05·06)이 별로다 →
// 정문·추모 구역·추모의 벽·묵념은 음악 없이 조용히(팀 결정 DECISIONS.md의 '추모 단계 무음'과도 같다).
// 다시 켜려면 MEMORIAL_SOUND = true, 크기는 TRACK_GAIN에서.
export const MEMORIAL_SOUND = false;
export const TRACK_GAIN: Partial<Record<LoopTrack, number>> = { "01": 0.8, "03": 0.85, "04": 0.3, "08": 0.7 };
export const FADE_OUT = 0.6;
export const FADE_IN = 1.5;
// 단발 곡이 나는 동안 배경음을 이만큼 낮춘다
const CUE_DUCK = 0.35;

export type SceneSound = {
  scene: string;
  // 지금 거점이 추모 거점(정문·추모의 벽)인가
  reverent?: boolean;
  // 이동 중 5·18 조용한 구역 안(추모 거점에 다가가는 길)
  hushed?: boolean;
  // 지금 단계가 봉지(회고) 단계인가
  epilogue?: boolean;
  // 최종 결과 화면인가(09만 한 번 울리고 다른 곡을 붙이지 않는다)
  final?: boolean;
};
const memorial = (): LoopTrack | null => (MEMORIAL_SOUND ? "05" : null);
// 장면 → 반복 곡(순수 함수, 시험 대상). null이면 반복 곡 없이 조용히.
export function trackForScene({ scene, reverent = false, hushed = false, epilogue = false, final = false }: SceneSound): LoopTrack | null {
  if (final) return null;
  switch (scene) {
    case "travel":
      return hushed ? memorial() : "03";
    case "memorial":
      return memorial();
    case "mission":
    case "report":
    case "waiting":
    case "lock":
    case "sacho":
    case "done":
      return epilogue ? "08" : reverent ? memorial() : "04";
    default:
      // 첫 화면·입장·대기실·보직·장비
      return "01";
  }
}

// ── 파일 받기(오디오를 열기 전에도 받아 둘 수 있다) ───────────────────
// 사파리 엔진인가(아이폰의 크롬·웨일 등도 웹킷이다). 안드로이드·데스크톱 크롬은 아니다
export function isWebKitAudio(ua: string) {
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Android/.test(ua);
}
export function fileFor(track: Track, ua: string) {
  const t: { file: string; webkitWav?: boolean } = TRACKS[track];
  return t.webkitWav && isWebKitAudio(ua) ? t.file.replace(/\.mp3$/, ".wav") : t.file;
}
const bytes = new Map<Track, Promise<ArrayBuffer | null>>();
export function fetchTrack(track: Track): Promise<ArrayBuffer | null> {
  let p = bytes.get(track);
  if (!p) {
    p = (async () => {
      try {
        if (typeof fetch !== "function" || typeof window === "undefined") return null;
        const res = await fetch(SOUND_BASE + fileFor(track, navigator.userAgent ?? ""));
        return res.ok ? await res.arrayBuffer() : null;
      } catch {
        return null;
      }
    })();
    bytes.set(track, p);
  }
  return p;
}

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // 옛 사파리는 콜백 방식만 안다
  return new Promise((resolve, reject) => {
    try {
      const r = ctx.decodeAudioData(data.slice(0), resolve, reject);
      if (r && typeof r.then === "function") r.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

// 반복 끝점: manifest 길이. 디코딩 길이가 그보다 짧으면 디코딩 길이.
export function loopEndFor(track: Track, decodedSeconds: number) {
  return Math.min(TRACKS[track].seconds, decodedSeconds);
}

export type FileDeck = {
  /** 반복 곡을 바꾼다. 같은 곡이면 아무 일도 하지 않는다. 바뀌면 true */
  set(track: LoopTrack | null): boolean;
  /** 단발 곡. 바로 틀 수 있으면 true(아직 못 받았거나 실패면 false: 합성 소리로 대신한다) */
  cue(track: CueTrack, gain?: number): boolean;
  /** 묵념: 05의 새·잎사귀(높은 소리)를 내리고 바람만 남긴다 */
  calm(on: boolean): void;
  failed(track: Track): boolean;
  /** 디코딩해 두어 바로 틀 수 있는가 */
  ready(track: Track): boolean;
  readonly track: LoopTrack | null;
};

export function createFileDeck(
  ctx: BaseAudioContext,
  out: AudioNode,
  hooks: { onFail?: (track: Track) => void; onStart?: (track: LoopTrack) => void } = {},
  cueOut: AudioNode = out,
): FileDeck {
  const buffers = new Map<Track, AudioBuffer>();
  const loading = new Map<Track, Promise<AudioBuffer | null>>();
  const broken = new Set<Track>();
  const duck = ctx.createGain();
  duck.connect(out);
  let want: LoopTrack | null = null;
  let calmOn = false;
  let playing: { track: LoopTrack; src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  const load = (track: Track): Promise<AudioBuffer | null> => {
    const have = buffers.get(track);
    if (have) return Promise.resolve(have);
    let p = loading.get(track);
    if (!p) {
      p = fetchTrack(track)
        .then((data) => (data ? decode(ctx, data) : null))
        .catch(() => null)
        .then((buf) => {
          loading.delete(track);
          // 디코딩한 뒤에는 받은 파일 바이트를 버린다(다시 필요하면 브라우저 캐시에서 받는다)
          if (buf) {
            buffers.set(track, buf);
            bytes.delete(track);
          }
          else if (!broken.has(track)) {
            broken.add(track);
            hooks.onFail?.(track);
          }
          return buf;
        });
      loading.set(track, p);
    }
    return p;
  };
  // 지금 곡과 다음 단계 곡만 디코딩해 두고 나머지는 버린다(단발 곡 02·07은 작아서 남긴다)
  const next = (track: Track) => NEXT[track].filter((t) => MEMORIAL_SOUND || (t !== "05" && t !== "06"));
  const keepOnly = (track: Track) => {
    const keep = new Set<Track>([track, ...next(track), "02", "07"]);
    for (const t of [...buffers.keys()]) if (!keep.has(t)) buffers.delete(t);
    for (const t of next(track)) void load(t);
  };
  const filterFreq = () => (calmOn ? 650 : 20000);

  const fadeOut = (p: NonNullable<typeof playing>, at: number) => {
    try {
      const g = p.gain.gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(0, at + FADE_OUT);
      p.src.stop(at + FADE_OUT + 0.05);
    } catch {}
  };
  const start = (track: LoopTrack, buf: AudioBuffer) => {
    const at = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = loopEndFor(track, buf.duration);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = track === "05" ? filterFreq() : 20000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime((track === "05" && calmOn ? 0.7 : 1) * (TRACK_GAIN[track] ?? 1), at + FADE_IN);
    src.connect(filter).connect(gain).connect(duck);
    src.start(at, 0);
    playing = { track, src, gain, filter };
    hooks.onStart?.(track);
  };

  return {
    get track() {
      return want;
    },
    failed: (track) => broken.has(track),
    ready: (track) => buffers.has(track),
    set(track) {
      if (track === want) return false;
      want = track;
      if (playing) {
        fadeOut(playing, ctx.currentTime);
        playing = null;
      }
      if (!track) return true;
      keepOnly(track);
      void load(track).then((buf) => {
        // 받는 사이에 다른 곡으로 바뀌었으면 틀지 않는다
        if (!buf || want !== track || playing) return;
        start(track, buf);
      });
      return true;
    },
    cue(track, gain = 1) {
      const buf = buffers.get(track);
      if (!buf) {
        void load(track);
        return false;
      }
      try {
        const at = ctx.currentTime + 0.01;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = gain;
        // 단발 곡은 배경음 낮춤(duck)을 거치지 않고 바로 낸다
        src.connect(g).connect(cueOut);
        src.start(at, 0);
        if (track !== "06") {
          const d = duck.gain;
          d.cancelScheduledValues(at);
          d.setValueAtTime(d.value, at);
          d.setTargetAtTime(CUE_DUCK, at, 0.08);
          d.setTargetAtTime(1, at + Math.min(TRACKS[track].seconds, 6), 0.5);
        }
        for (const t of next(track)) void load(t);
        return true;
      } catch {
        return false;
      }
    },
    calm(on) {
      if (calmOn === on) return;
      calmOn = on;
      if (!playing || playing.track !== "05") return;
      try {
        const at = ctx.currentTime;
        playing.filter.frequency.setTargetAtTime(filterFreq(), at, 0.8);
        playing.gain.gain.setTargetAtTime(on ? 0.7 : 1, at, 0.8);
      } catch {}
    },
  };
}
