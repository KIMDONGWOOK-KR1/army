"use client";
import { useEffect, useState, type ReactNode } from "react";
import * as THREE from "three";
import { loadFieldAssets } from "./field-assets";
import { crewSoldier } from "./soldier-props";
import { soldierVariant } from "./soldier-variants";
import { disposeTree } from "./field-3d";
import type { Role } from "@/supabase/functions/_shared/types";

// 문제를 푸는 화면 머리의 작은 초상: 내 장병이 보직 소품을 들고 조사하는 모습.
// 한 번만 그려 그림으로 바꾸고 3D 화면은 바로 닫는다(문제를 푸는 동안 폰이 계속 그리지 않게).
// 추모·회고 단계에서는 소품을 넣어 둔 평소 모습으로 그린다.
const cache = new Map<string, string>();
const SIZE = 192;

export function RolePortrait({ role, look, action, fallback }: { role: Role; look: string; action: boolean; fallback: ReactNode }) {
  const key = `${role}:${look}:${action ? 1 : 0}`;
  const [drawn, setDrawn] = useState<{ key: string; src: string } | null>(null);
  const src = cache.get(key) ?? (drawn?.key === key ? drawn.src : null);
  useEffect(() => {
    if (cache.has(key)) return;
    let active = true;
    loadFieldAssets().then((assets) => {
      if (!active || !assets.soldier || cache.has(key)) return;
      let renderer: THREE.WebGLRenderer | null = null;
      try {
        const canvas = document.createElement("canvas");
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(SIZE, SIZE, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.5;
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0xb5ae90, 3));
        const light = new THREE.DirectionalLight(0xfff3df, 4);
        light.position.set(-2, 4, 5);
        scene.add(light);
        const hero = crewSoldier(assets.soldier, { height: 1, role, variant: soldierVariant(look), action });
        hero.group.children[1].visible = false; // 발밑 고리는 초상에서 뺀다
        scene.add(hero.group);
        // 머리와 손에 든 소품이 들어가는 윗몸 구도(모형 키 1)
        const camera = new THREE.OrthographicCamera(-0.62, 0.62, 0.62, -0.62, 0.01, 20);
        camera.position.set(0, 0.7, 5);
        camera.lookAt(0, 0.7, 0);
        renderer.render(scene, camera);
        const url = canvas.toDataURL("image/png");
        cache.set(key, url);
        disposeTree(hero.group);
        if (active) setDrawn({ key, src: url });
      } catch {
        // 그림을 못 그리면 보직 아이콘을 그대로 둔다
      } finally {
        renderer?.dispose();
        renderer?.forceContextLoss();
      }
    });
    return () => {
      active = false;
    };
  }, [key, role, look, action]);
  return src ? <img className="role-portrait" src={src} alt="" width={84} height={84} draggable={false} /> : <>{fallback}</>;
}
