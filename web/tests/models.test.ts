import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_FILES, TREE_NAMES } from "../components/field-assets";
import {
  LANDMARK_SLOTS,
  type LandmarkManifest,
} from "../components/field-landmark-slots";
import { renderHeight } from "../components/field-buildings";
import jnu from "../components/maps/jnu.json";

// 블렌더에서 내보낸 필드 모형(public/models)이 field-assets.ts가 찾는 이름·속성을 갖췄는지 본다.
const DIR = join(__dirname, "..", "public", "models");

type Gltf = {
  nodes: { name?: string; mesh?: number; skin?: number }[];
  meshes: {
    primitives: { indices?: number; attributes: Record<string, number> }[];
  }[];
  accessors?: { count: number; min?: number[]; max?: number[] }[];
  animations?: { name: string }[];
  images?: unknown[];
};

function readGlb(file: string): Gltf {
  const b = readFileSync(join(DIR, file));
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  expect(b.readUInt32LE(4)).toBe(2);
  const len = b.readUInt32LE(12);
  expect(b.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

// 노드 형상의 꼭짓점 높이(y)들: BIN 덩이에서 POSITION(float32 vec3)을 읽는다
function vertexHeights(file: string, name: string) {
  const b = readFileSync(join(DIR, file)),
    len = b.readUInt32LE(12),
    g = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as Gltf & {
      bufferViews: { byteOffset?: number; byteStride?: number }[];
      accessors: { bufferView: number; byteOffset?: number; count: number }[];
    },
    bin = 20 + len + 8;
  const node = g.nodes.find((n) => n.name === name)!,
    a = g.accessors[g.meshes[node.mesh!].primitives[0].attributes.POSITION],
    v = g.bufferViews[a.bufferView],
    stride = v.byteStride ?? 12,
    off = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
    ys: number[] = [];
  for (let k = 0; k < a.count; k++) ys.push(b.readFloatLE(off + k * stride + 4));
  return ys;
}

function attributesOf(g: Gltf, name: string) {
  const node = g.nodes.find((n) => n.name === name);
  expect(node, `${name} 노드`).toBeDefined();
  expect(node!.mesh, `${name} 형상`).toBeDefined();
  return Object.keys(g.meshes[node!.mesh!].primitives[0].attributes);
}

describe("필드 모형 파일", () => {
  it("폰에서 받기 부담스럽지 않은 크기다(모두 합쳐 3.5MB 이하)", () => {
    const total = MODEL_FILES.reduce(
      (n, f) => n + statSync(join(DIR, f)).size,
      0,
    );
    expect(total).toBeLessThan(3.5 * 1024 * 1024);
  });

  it("나무 모형은 종류마다 자세한·줄인 모형이 있고 꼭짓점 색을 갖는다", () => {
    const kit = readGlb("kit.glb");
    for (const name of Object.values(TREE_NAMES).flat())
      for (const n of [name, `${name}_lo`])
        expect(attributesOf(kit, n)).toEqual(
          expect.arrayContaining(["POSITION", "NORMAL", "COLOR_0"]),
        );
  });

  it("정문·용봉관·용봉탑은 꼭짓점 색을 입힌 한 덩어리 형상이다", () => {
    for (const [file, name] of [
      ["gate.glb", "LM_gate"],
      ["hall.glb", "LM_hall"],
      ["tower.glb", "LM_tower"],
    ])
      expect(attributesOf(readGlb(file), name)).toEqual(
        expect.arrayContaining(["POSITION", "NORMAL", "COLOR_0"]),
      );
  });

  it("장병은 뼈대·무늬와 걷기·서기 동작을 갖는다", () => {
    const g = readGlb("soldier.glb");
    const skinned = g.nodes.find((n) => n.skin !== undefined);
    expect(skinned?.mesh).toBeDefined();
    expect(
      Object.keys(g.meshes[skinned!.mesh!].primitives[0].attributes),
    ).toEqual(expect.arrayContaining(["JOINTS_0", "WEIGHTS_0", "TEXCOORD_0"]));
    expect(g.images?.length).toBe(1);
    expect((g.animations ?? []).map((a) => a.name)).toEqual(
      expect.arrayContaining(["Walk", "Idle"]),
    );
  });
});

// 랜드마크 건물 모형 목록(public/models/landmarks.json): 필드가 뜬 뒤 따로 받고, 파일이 없으면
// 코드로 빚은 건물이 그대로 선다. MODEL_FILES(처음 받는 모형)에는 넣지 않는다.
describe("랜드마크 건물 모형 목록", () => {
  const manifest = JSON.parse(
    readFileSync(join(DIR, "landmarks.json"), "utf8"),
  ) as LandmarkManifest;

  it("민주마루·정보마루·대학본부 자리를 적었고, 자리 이름이 코드의 랜드마크 자리와 맞는다", () => {
    const keys = manifest.entries.map((e) => e.key).sort();
    expect(keys).toEqual(["hq", "jungbomaru", "minjumaru"]);
    const slots = new Set(
      LANDMARK_SLOTS.filter((s) => !s.external).map((s) => s.key),
    );
    for (const e of manifest.entries) {
      expect(slots.has(e.key), e.key).toBe(true);
      expect(e.node.startsWith("LM_"), e.node).toBe(true);
      expect(e.file.endsWith(".glb"), e.file).toBe(true);
    }
  });

  it("있는 모형은 꼭짓점 색을 갖고 한 채 300KB·삼각형 8천 개 이하, 없는 모형은 optional이다", () => {
    for (const e of manifest.entries) {
      const path = join(DIR, e.file);
      if (!existsSync(path)) {
        expect(e.optional, `${e.file} 없음`).toBe(true);
        continue;
      }
      expect(statSync(path).size).toBeLessThanOrEqual(300 * 1024);
      const g = readGlb(e.file);
      expect(attributesOf(g, e.node)).toEqual(
        expect.arrayContaining(["POSITION", "NORMAL", "COLOR_0"]),
      );
      const node = g.nodes.find((n) => n.name === e.node)!,
        acc = g.accessors ?? [];
      const tris = g.meshes[node.mesh!].primitives.reduce(
        (n, p) =>
          n + acc[p.indices ?? p.attributes.POSITION].count / 3,
        0,
      );
      expect(tris).toBeLessThanOrEqual(8000);
    }
  });

  // 모형 높이가 지도 높이 규칙(renderHeight)을 따른다: 꼭짓점 99%가 닿는 높이는 ±10% 안,
  // 맨 꼭대기는 1.3배 안(민주마루 뒤 강당의 3m 피라미드 지붕은 사진대로 판상 위로 솟는다).
  it("모형 높이(상자 가로에 맞춘 뒤)가 지도 높이 규칙을 따른다", () => {
    const map = jnu as unknown as {
      buildings: { id: string; h: number }[];
      boxes: Record<string, { w: number }>;
    };
    for (const e of manifest.entries) {
      if (!existsSync(join(DIR, e.file))) continue;
      const slot = LANDMARK_SLOTS.find((s) => s.key === e.key)!;
      const b = map.buildings.find((x) => x.id === slot.osmId)!;
      const box = map.boxes[slot.box ?? e.key];
      const ys = vertexHeights(e.file, e.node).sort((p, q) => p - q);
      const g = readGlb(e.file);
      const node = g.nodes.find((n) => n.name === e.node)!;
      const pos = g.accessors![g.meshes[node.mesh!].primitives[0].attributes.POSITION];
      const s = e.fit === "footprint" ? box.w / (pos.max![0] - pos.min![0]) : 1;
      const want = renderHeight(b.h),
        p99 = (ys[Math.floor(0.99 * (ys.length - 1))] * s) / want,
        top = (ys[ys.length - 1] * s) / want;
      expect(p99, `${e.key} 99% 높이 비`).toBeGreaterThan(0.9);
      expect(p99, `${e.key} 99% 높이 비`).toBeLessThan(1.1);
      expect(top, `${e.key} 꼭대기 비`).toBeLessThan(1.3);
    }
  });

  it("처음 받는 모형 목록(MODEL_FILES)은 그대로다", () => {
    expect([...MODEL_FILES]).toEqual([
      "kit.glb",
      "gate.glb",
      "hall.glb",
      "tower.glb",
      "soldier.glb",
    ]);
  });
});
