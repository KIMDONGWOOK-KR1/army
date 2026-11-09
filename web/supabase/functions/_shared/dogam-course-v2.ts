// Synthetic review fixture only. Actual mission answers remain in private server seeds.
import { legacyFullDemoV2Input } from "./legacy-full-course-v2.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { ROLES, type Role, type Step } from "./types.ts";
export const DOGAM_GATE_STEPS = {
 commander: ["G-01.dogam-q2", "G-01.dogam-q3", "G-01.dogam-q4"],
 scout: ["G-02.dogam-flame"], signal: ["G-03.dogam"], cipher: ["G-04.dogam"],
} as const satisfies Record<Role, readonly string[]>;
export function dogamFullDemoV2Input(id: string) {
 const {content,privateInput}=legacyFullDemoV2Input(id);
 const gate=content.stages.find(s=>s.id==="gate")!;
 const names={commander:"정문 퀴즈",scout:"불꽃 찾기",signal:"무전기",cipher:"기록 닦기"};
 const steps: Record<Role,Step[]> = Object.fromEntries(ROLES.map(role=>[role,DOGAM_GATE_STEPS[role].map((id,index)=>({
  id,confirmed:false,sourceRequired:false,maxLen:300,
  type:role==="scout"?"confirm":role==="commander"&&index===1?"order":"choice",
  grading:role==="scout"?"confirm":role==="commander"&&index===1?"order-hash":"hash",
  prompt:role==="scout"?"[합성 시연] 사진 판정 연결을 확인해요.":role==="commander"&&index===1?"[합성 시연] 연습 카드를 1, 2, 3 순서로 놓아요.":"[합성 시연] 첫 번째 연습 카드를 골라요. 실제 현장 문항이 아니에요.",
  ...(role!=="scout"?{choices:role==="commander"&&index===1?["연습 1","연습 2","연습 3"]:["연습 A","연습 B","연습 C","연습 D"]}:{}),
 }))])) as Record<Role,Step[]>;
 const privateGate=privateInput.stages.gate;
 privateGate.steps={};
 for(const role of ROLES){
  gate.roles[role]={intro:{id:`dogam-${role}-intro`,channel:"screen",trigger:"enter",text:names[role]},scenes:[],digit:true,steps:steps[role]};
  privateGate.roles[role]!.hints=["합성 연습 문항이에요.","문제의 안내를 따라 해요.","연습을 마치고 흐름을 확인해요."];
  delete privateGate.roles[role]!.transferClue;
  for(const step of steps[role]) privateGate.steps[step.id]={
   ...(step.type==="confirm"?{}:{answer:step.type==="order"?["1","2","3"]:"1"}),
   explanation:"합성 문항의 진행을 확인했어요. 실제 문항은 비공개 서버 시드에서 설정해요.",
  };
 }
 delete gate.altModes;
 content.name="[합성 개발용] 정문 도감 · 네 거점";
 return {content,privateInput};
}
export function dogamFullDemoCourseV2(id:string,salt:string){
 const {content,privateInput}=dogamFullDemoV2Input(id);
 return prepareCourseV2(content,privateInput,salt);
}
