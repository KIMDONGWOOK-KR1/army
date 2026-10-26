"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadFieldAssets } from "./field-assets";
import { crewSoldier } from "./soldier-props";
import { HOME_VARIANTS } from "./soldier-variants";
import { ROLES } from "@/supabase/functions/_shared/types";
import { disposeTree } from "./field-3d";

// row: 좁은 화면에서도 네 사람을 한 줄로 세운다(결과 화면의 단체 사진)
export function CharacterLineup({ row = false, className = "character-lineup" }: { row?: boolean; className?: string } = {}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState("캐릭터 준비 중");
  useEffect(() => {
    let active = true;
    let cleanup = () => {};
    loadFieldAssets().then(assets => {
      if (!active || !host.current) return;
      if (!assets.soldier) { setState("캐릭터를 불러오지 못했어요"); return; }
      try {
        const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
        renderer.setPixelRatio(Math.min(devicePixelRatio,2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.5;
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff,0xb5ae90,3));
        const light = new THREE.DirectionalLight(0xfff3df,4); light.position.set(-2,4,5); scene.add(light);
        const mount = new THREE.Group(); scene.add(mount);
        const crew = ROLES.map(role => {
          const hero=crewSoldier(assets.soldier!,{height:1,role,variant:HOME_VARIANTS[role]});
          mount.add(hero.group); return hero;
        });
        const camera = new THREE.OrthographicCamera(-2,2,1,-1,.01,20);
        const el=host.current;
        el.appendChild(renderer.domElement);
        const draw=()=>{
          const w=el.clientWidth,h=el.clientHeight, narrow=!row&&w<600;
          renderer.setSize(w,h);
          const viewH=Math.max(narrow?2.8:1.35, (narrow?1.95:3.9)*h/w);
          camera.left=-viewH*w/h/2;camera.right=viewH*w/h/2;camera.top=viewH/2;camera.bottom=-viewH/2;
          camera.position.set(0,.65,5); camera.lookAt(0,.65,0);camera.updateProjectionMatrix();
          crew.forEach((hero,i)=>hero.group.position.set(narrow?(i%2-.5)*.9:(i-1.5)*.87,narrow?(i<2?.6:-.65):0,0));
          renderer.render(scene,camera);
        };
        const observer=new ResizeObserver(draw);observer.observe(el);draw();setState("ready");
        cleanup=()=>{observer.disconnect();disposeTree(mount);renderer.dispose();renderer.domElement.remove();};
      } catch { setState("이 브라우저에서 입체 미리보기를 사용할 수 없어요"); }
    });
    return()=>{active=false;cleanup();};
  },[row]);
  return <div className={className} ref={host} data-ready={state==="ready"} role="img" aria-label="파란 깃발을 높이 든 지휘관, 쌍안경을 눈에 댄 정찰원, 무전기를 귀에 댄 통신원, 큰 열쇠를 든 암호해독관">{state!=="ready"&&<p>{state}</p>}</div>;
}
