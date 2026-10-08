import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  chainOnBeforeCompile,
  ghostOpacity,
  heroBlocked,
  isSeeThrough,
  isSoftSeeThrough,
  patchClayRimShader,
  patchSeeThroughShader,
  resetSeeThrough,
  SEE,
  SEE_SOFT,
  seeThrough,
  shaderPatches,
  updateSeeThrough,
} from "../components/field-occlusion";
import { LodInstancer } from "../components/field-instances";

type ShaderArg = Parameters<THREE.Material["onBeforeCompile"]>[0];
const shaderOf = (lib: keyof typeof THREE.ShaderLib) => ({
  vertexShader: THREE.ShaderLib[lib].vertexShader,
  fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  uniforms: {} as Record<string, THREE.IUniform>,
});

describe("시야 구멍 셰이더 고치기(three 0.186 원문)", () => {
  for (const lib of [
    "standard",
    "physical",
    "lambert",
    "phong",
    "basic",
  ] as const)
    it(`${lib} 재질에 들어간다`, () => {
      const s = shaderOf(lib);
      expect(patchSeeThroughShader(s)).toBe(true);
      expect(s.vertexShader).toContain(
        "vSeeWorld = ( modelMatrix * seeW ).xyz;",
      );
      expect(s.vertexShader).toContain("instanceMatrix * seeW");
      // 고친 뒤에도 원래 줄은 남아 다른 고치기가 찾을 수 있다
      expect(s.vertexShader).toContain("#include <project_vertex>");
      expect(s.fragmentShader).toContain("#include <clipping_planes_fragment>");
      expect(s.fragmentShader).toMatch(/#ifdef SEE_CUT[\s\S]*discard/);
      expect(Object.keys(s.uniforms)).toEqual(
        expect.arrayContaining(["uSeeEye", "uSeeHero", "uSeeCut", "uSeeShape"]),
      );
    });

  it("고칠 자리가 없는 셰이더는 그대로 둔다", () => {
    const s = {
      vertexShader: "void main(){}",
      fragmentShader: "void main(){}",
      uniforms: {},
    };
    expect(patchSeeThroughShader(s)).toBe(false);
    expect(s.vertexShader).toBe("void main(){}");
  });

  it("점토 가장자리 빛은 빛을 받는 재질에만 넣는다", () => {
    const std = shaderOf("standard"),
      basic = shaderOf("basic");
    expect(patchClayRimShader(std)).toBe(true);
    expect(std.fragmentShader).toContain("uClayRim");
    expect(patchClayRimShader(basic)).toBe(false);
  });
});

describe("셰이더 고치기 잇기", () => {
  it("먼저 넣어 둔 onBeforeCompile과 캐시 열쇠를 맨 앞에 살린다", () => {
    const m = new THREE.MeshStandardMaterial(),
      ran: string[] = [];
    m.onBeforeCompile = () => ran.push("tint");
    m.customProgramCacheKey = () => "role-tint";
    chainOnBeforeCompile(m, "dither", () => ran.push("dither"));
    m.onBeforeCompile({} as ShaderArg, {} as THREE.WebGLRenderer);
    expect(ran).toEqual(["tint", "dither"]);
    expect(m.customProgramCacheKey()).toBe("role-tint|dither");
  });

  it("seeThrough는 같은 재질에 시야 구멍과 가장자리 빛을 한 번씩만 넣는다", () => {
    const m = new THREE.MeshStandardMaterial();
    expect(seeThrough(seeThrough(m))).toBe(m);
    expect(isSeeThrough(m)).toBe(true);
    expect(shaderPatches(m)).toEqual(["see-through", "clay-rim"]);
    // 창 띠 같은 다른 작업자의 고치기를 더해도 열쇠가 겹치지 않는다
    chainOnBeforeCompile(m, "windows", () => {});
    expect(m.customProgramCacheKey()).toBe("see-through|clay-rim|windows");
  });

  it("재질을 복제해도 원본의 고치기 목록은 망가지지 않는다", () => {
    const m = seeThrough(new THREE.MeshStandardMaterial()),
      c = m.clone();
    expect(shaderPatches(c)).toEqual([]);
    expect(() =>
      chainOnBeforeCompile(c, "windows", () => {}).onBeforeCompile(
        {} as ShaderArg,
        {} as THREE.WebGLRenderer,
      ),
    ).not.toThrow();
  });
});

// 카메라(0, 40, 80) → 캐릭터 발(0, 0, 0). 가슴은 (0, 4.25, 0).
const EYE = new THREE.Vector3(0, 40, 80),
  FOOT = new THREE.Vector3(0, 0, 0);
const scene = () => new THREE.Scene();
const box = (x: number, y: number, z: number, s: number, see = true) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    see
      ? seeThrough(new THREE.MeshStandardMaterial())
      : new THREE.MeshStandardMaterial(),
  );
  m.position.set(x, y, z);
  m.updateMatrixWorld();
  return m;
};

describe("가림 검사", () => {
  it("카메라와 캐릭터 사이 건물은 가림으로 본다", () => {
    const s = scene();
    // 선분 위 중간쯤(0, 20, 40) 둘레 10m 상자
    s.add(box(0, 20, 40, 10));
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(true);
  });

  it("캐릭터 뒤나 옆의 건물, 시야 구멍을 넣지 않은 물체는 가림이 아니다", () => {
    const s = scene();
    s.add(box(0, 5, -20, 10)); // 캐릭터 뒤
    s.add(box(40, 5, 20, 10)); // 옆
    s.add(box(0, 20, 40, 10, false)); // 땅·표석처럼 시야 구멍이 없는 것
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(false);
  });

  it("캐릭터 몸 바로 앞(1.5m 안)은 가림으로 치지 않는다", () => {
    const s = scene();
    s.add(box(0, 4.5, 0.6, 0.6)); // 가슴 바로 앞 1m 안의 작은 상자
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(false);
  });

  it("나무·소품(부드러운 구멍)은 몸 앞 0.6m까지를 가림으로 본다", () => {
    const s = scene(),
      m = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        seeThrough(new THREE.MeshStandardMaterial(), "soft"),
      );
    m.position.set(0, 4.5, 0.6); // 위 시험과 같은 자리(가슴 앞 0.3~1m)
    s.add(m);
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(true);
  });

  it("인스턴스 나무 하나가 선분을 막으면 가림으로 본다", () => {
    const s = scene(),
      mat = seeThrough(new THREE.MeshStandardMaterial()),
      trees = new THREE.InstancedMesh(new THREE.ConeGeometry(3, 18, 8), mat, 3),
      m = new THREE.Matrix4();
    trees.setMatrixAt(0, m.makeTranslation(60, 9, -30));
    trees.setMatrixAt(1, m.makeTranslation(-50, 9, 10));
    trees.setMatrixAt(2, m.makeTranslation(0, 9, 16)); // 카메라 쪽 16m
    trees.computeBoundingSphere();
    s.add(trees);
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(true);
    trees.count = 2;
    expect(heroBlocked(s, EYE, FOOT)).toBe(false);
  });

  it("거리 단계 묶음은 그루가 바뀌면 옛 경계 공으로 새 나무를 걸러 내지 않는다", () => {
    // 캐릭터에서 멀리(300m) 있던 나무 묶음의 경계 공을 누가 한 번 셈해 둔 뒤(탭 판정 등),
    // 캐릭터가 다른 나무 곁으로 가서 묶음 안 그루가 바뀌어도 가림을 찾아야 한다
    const s = scene(),
      inst = new LodInstancer<string>({
        name: "t",
        levels: [{ max: 90 }, { max: 600 }],
        material: seeThrough(new THREE.MeshStandardMaterial(), "soft"),
        shape: () => ({ geos: [new THREE.ConeGeometry(3, 18, 8).translate(0, 9, 0), null] }),
      });
    inst.add("a", new THREE.Matrix4().makeTranslation(300, 0, -300), new THREE.Color(1, 1, 1));
    inst.add("a", new THREE.Matrix4().makeTranslation(0, 0, 16), new THREE.Color(1, 1, 1));
    const update = inst.build(s);
    update(300, -300);
    s.updateMatrixWorld();
    inst.meshes[0].computeBoundingSphere();
    update(0, 0);
    expect(inst.meshes[0].count).toBe(1);
    expect(heroBlocked(s, EYE, FOOT)).toBe(true);
  });

  it("몸 반쪽만 가린 것은 가슴 양옆 선으로 찾는다", () => {
    const s = scene();
    // 카메라 쪽 10m, 가운데 선(x 0)에서 0.8~1.6m 비킨 가는 기둥: 가운데 선은 비키고 옆 선은 맞는다
    s.add(box(1.2, 8.7, 10, 0.8));
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(false);
    expect(heroBlocked(s, EYE, FOOT, [SEE.chest], SEE.side)).toBe(true);
    expect(heroBlocked(s, EYE, FOOT, [SEE.chest], -SEE.side)).toBe(false);
    resetSeeThrough();
    const cam = new THREE.PerspectiveCamera();
    cam.position.copy(EYE);
    cam.updateMatrixWorld();
    let cut = 0;
    for (let i = 0; i < 40; i++) cut = updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(cut).toBe(1);
    resetSeeThrough();
  });

  it("큰 합친 형상(격자로 나눔)도 지나는 삼각형만 찾아 맞힌다", () => {
    const s = scene(),
      parts: THREE.BufferGeometry[] = [];
    // 3000개 남짓 삼각형: 멀리 흩어진 작은 상자들 + 선분 위 상자 하나
    for (let i = 0; i < 250; i++)
      parts.push(
        new THREE.BoxGeometry(2, 2, 2).translate(
          200 + (i % 25) * 5,
          1,
          -200 + Math.floor(i / 25) * 5,
        ),
      );
    const far = new THREE.Mesh(
      merge(parts),
      seeThrough(new THREE.MeshStandardMaterial()),
    );
    s.add(far);
    s.updateMatrixWorld();
    expect(heroBlocked(s, EYE, FOOT)).toBe(false);
    parts.push(new THREE.BoxGeometry(12, 12, 12).translate(0, 20, 40));
    far.geometry = merge(parts);
    expect(heroBlocked(s, EYE, FOOT)).toBe(true);
  });
});

describe("시야 구멍 열고 닫기", () => {
  it("가리면 0.2초에 걸쳐 열리고, 풀리면 잠시 뒤 닫힌다", () => {
    resetSeeThrough();
    const s = scene(),
      cam = new THREE.PerspectiveCamera();
    cam.position.copy(EYE);
    cam.updateMatrixWorld();
    const wall = box(0, 20, 40, 10);
    s.add(wall);
    s.updateMatrixWorld();
    let cut = 0;
    for (let i = 0; i < 30; i++) cut = updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(cut).toBe(1);
    s.remove(wall);
    for (let i = 0; i < 6; i++) cut = updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(cut).toBe(1); // 바로 닫지 않는다
    for (let i = 0; i < 60; i++) cut = updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(cut).toBe(0);
    expect(ghostOpacity(0)).toBe(SEE.ghost[0]);
    expect(ghostOpacity(1)).toBeCloseTo(SEE.ghost[1]);
  });

  it("구멍이 열린 동안만 재질에 지우는 정의(SEE_CUT)가 붙는다", () => {
    resetSeeThrough();
    const s = scene(),
      cam = new THREE.PerspectiveCamera(),
      wall = box(0, 20, 40, 10),
      mat = wall.material as THREE.Material;
    cam.position.copy(EYE);
    cam.updateMatrixWorld();
    updateSeeThrough(cam, FOOT, 1 / 60, s);
    for (let i = 0; i < 10; i++) updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(mat.defines?.SEE_CUT).toBeUndefined();
    s.add(wall);
    s.updateMatrixWorld();
    for (let i = 0; i < 10; i++) updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(mat.defines?.SEE_CUT).toBe("");
    s.remove(wall);
    for (let i = 0; i < 90; i++) updateSeeThrough(cam, FOOT, 1 / 60, s);
    expect(mat.defines?.SEE_CUT).toBeUndefined();
  });
});

function merge(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  for (const g of parts) {
    const n = g.toNonIndexed().attributes.position;
    for (let i = 0; i < n.count; i++) pos.push(n.getX(i), n.getY(i), n.getZ(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

describe("부드러운 시야 구멍(나무·소품)", () => {
  it("SEE_SOFT 정의로 따로 컴파일하고, 가운데를 남기지 않는 모양을 쓴다", () => {
    const soft = seeThrough(new THREE.MeshLambertMaterial(), "soft"),
      solid = seeThrough(new THREE.MeshLambertMaterial());
    expect(isSoftSeeThrough(soft)).toBe(true);
    expect(isSoftSeeThrough(solid)).toBe(false);
    expect("SEE_SOFT" in (soft.defines ?? {})).toBe(true);
    expect("SEE_SOFT" in (solid.defines ?? {})).toBe(false);
    expect(SEE_SOFT.keep).toBe(0);
    expect(SEE_SOFT.r0).toBeLessThan(SEE.r0);
    expect(SEE_SOFT.frontEnd).toBeLessThan(SEE.frontEnd);
    const sh = shaderOf("lambert");
    expect(patchSeeThroughShader(sh)).toBe(true);
    expect(sh.fragmentShader).toContain("#ifdef SEE_SOFT");
    expect(Object.keys(sh.uniforms)).toEqual(
      expect.arrayContaining(["uSeeSoftShape", "uSeeSoftFrontEnd"]),
    );
    const u = sh.uniforms.uSeeSoftShape.value as THREE.Vector4;
    expect([u.x, u.y, u.z]).toEqual([SEE_SOFT.r0, SEE_SOFT.r1, SEE_SOFT.keep]);
  });
});
