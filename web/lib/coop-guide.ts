import type { V2Response } from "./game-snapshot";
import { ROLES, ROLE_NAMES } from "@/supabase/functions/_shared/types";

// This projection reads only the caller's already-filtered snapshot. It never fetches teammates' clues.
export function coopGuide(s: V2Response) {
  const { game, self, stage } = s;
  const mine = self.role ? ROLES.indexOf(self.role) : -1;
  const complete = !!game.completion || game.status === "done";
  const traveling = game.site_phase === "travel" && !complete;
  const tribute = stage.completion.type === "tribute";
  const closing = stage.completion.type === "joint-record";
  const confirming = stage.completion.type === "confirm";
  const draft = closing ? self.joint_record : confirming ? self.memorial_record : undefined;
  const consent = !!draft && (closing ? !!game.retro_mask?.every(Boolean) : confirming && game.report_mask.every(Boolean));
  const mask = complete ? ROLES.map(() => true) : traveling ? game.arrival_mask
    : consent ? draft!.confirm_mask : closing ? game.retro_mask ?? [] : game.report_mask;
  const label = complete ? "함께 완료" : traveling ? "도착 확인" : tribute ? "헌화" : consent ? "공동 기록 동의" : closing ? "회고 저장" : "조사 보고";
  const next = s.course.sites.find(site => site.seq > stage.seq);
  // 기다리는 이유: 아직 끝내지 않은 동료의 보직 이름만 쓴다(단서·본문은 읽지 않는다)
  const others = ROLES.filter((role, i) => role !== self.role && !mask[i]).map(role => ROLE_NAMES[role]).join("·");
  const waitFor = (noun: string) => others ? `${others}의 ${noun}${josa(noun, "을", "를")} 기다려요.` : "";
  let action: string;
  if (game.status === "done") action = "함께 남긴 문장을 읽고 오늘의 탐방을 돌아봐요.";
  else if (complete) action = next ? self.role === "commander"
    ? `기록을 읽은 뒤 ${next.name} 출발을 알려요.`
    : `기록을 읽으며 지휘관의 ${next.name} 출발을 기다려요.` : "함께 완성한 기록을 읽어요.";
  else if (traveling) action = mask[mine]
    ? `내 도착은 확인됐어요. ${waitFor("도착") || "곧 다음 장면이 열려요."}`
    : "목적지로 걸어가 내 도착을 확인해요. 동료와 주변도 살펴요.";
  else if (tribute) action = mask[mine]
    ? `국화를 올렸어요. ${others ? `${others}이 마음을 전하는 동안` : "잠시"} 조용히 머물러요.`
    : "장소의 이야기를 읽고, 내 국화 한 송이를 올려요.";
  else if (closing) action = !self.retro ? "오늘 기억에 남은 순간을 내 회고에 남겨요. 본문은 나만 볼 수 있어요."
    : !game.retro_mask?.every(Boolean) ? `내 회고를 저장했어요. ${waitFor("회고")}`
    : !draft ? self.role === "commander" ? "네 사람의 회고가 모였어요. 공동 문장과 근거를 작성해요." : "지휘관이 공동 문장을 작성하면 함께 읽고 동의해요."
    : draft.confirm_mask[mine] ? `현재 기록에 동의했어요. ${waitFor("동의")} 내용이 바뀌면 다시 확인해요.`
    : "최신 공동 문장과 근거를 읽고, 내 기기에서 동의해요.";
  else if (confirming && game.report_mask.every(Boolean)) action = !draft
    ? self.role === "commander" ? "조사 보고가 모였어요. 공동 문장과 근거를 작성해요." : "지휘관이 공동 문장을 작성하면 함께 읽고 확인해요."
    : draft.confirm_mask[mine] ? `현재 기록을 확인했어요. ${waitFor("확인")}` : "공동 문장과 근거를 읽고 내 기기에서 확인해요.";
  else if (self.reported) action = self.role === "commander"
    ? game.report_mask.every(Boolean) ? "보고가 모두 모였어요. 동료에게 들은 숫자로 팀 자물쇠를 열어요." : `내 보고를 마쳤어요. 동료의 숫자를 말로 모으며 ${waitFor("보고")}`
    : self.digit !== null ? game.report_mask.every(Boolean) ? "내 숫자를 지휘관에게 말로 전해요. 이제 지휘관이 자물쇠를 열 차례예요." : `내 숫자를 지휘관에게 말로 전해요. ${waitFor("보고")}`
    : "내 해설을 확인하고, 동료와 조사한 내용을 나누어요.";
  else {
    const pending = Object.entries(self.step_progress).filter(([, step]) => !["done", "explained"].includes(step.status));
    if (!pending.length && self.mission) action = "내 조사가 끝났어요. 아래에서 조사 보고를 마쳐요.";
    else if (pending.length && pending.every(([, step]) => step.status === "locked")) {
      const required = new Set(pending.flatMap(([id]) => {
        const step = self.mission?.steps.find(item => item.id === id);
        return [...(step?.requiresReports ?? []), ...(step?.requires?.map(r => r.role) ?? [])].filter(r => r !== self.role);
      }));
      const who = [...required].map(r => ROLE_NAMES[r]).join("·") || "동료";
      action = `${who}의 조사가 이어지면 내 다음 단서가 열려요. 서로 찾은 내용을 말로 나누어요.`;
    } else action = "열린 단서를 조사하고 내 보고를 완성해요. 숫자는 동료에게 말로 전해요.";
  }
  // 팀 퀘스트 이름: 지금 네 사람이 함께 채우는 목표 하나
  // 접힌 한 줄에 들어가도록 짧게 쓴다(장소 이름은 화면 위에 이미 있다)
  const goal = complete ? "이곳의 기록 완성"
    : traveling ? "다 함께 모이기"
    : tribute ? "국화 올리기"
    : consent ? "공동 기록 동의"
    : closing ? "회고 모으기"
    : confirming ? "공동 기록 확인"
    : "자물쇠 함께 열기";
  const dest = next?.name ?? "결과";
  const until = game.status === "done" ? "" : complete ? next ? `지휘관이 출발을 알리면 ${dest}${toward(dest)} 이동해요` : "모두의 기록이 결과에 남아요"
    : traveling ? "네 사람 모두 도착하면 조사가 열려요"
    : tribute ? "네 사람 모두 국화를 올리면 다음으로 이어져요"
    : consent ? "네 사람 모두 같은 버전에 동의하면 탐방이 끝나요"
    : closing ? "네 회고가 모이면 지휘관이 공동 문장을 써요"
    : confirming ? "네 사람 모두 확인하면 다음으로 이어져요"
    : game.report_mask.every(Boolean) ? "지휘관이 네 숫자로 자물쇠를 열면 이곳의 기록이 복원돼요"
    : "네 보고가 모이고 지휘관이 자물쇠를 열면 기록이 복원돼요";
  // 접힌 한 줄: 내 몫을 마쳤고 동료를 기다리는 중이면 그 이유를, 아니면 팀 목표를 보여 준다
  const pending = ROLES.filter((role, i) => role !== self.role && !mask[i]).length;
  const waiting = !complete && game.status !== "done" && mine >= 0 && !!mask[mine] && pending > 0;
  const headline = waiting ? `동료 ${pending}명 기다려요` : goal;
  return {
    goal, headline, waiting, action, until, label, count: mask.filter(Boolean).length, quiet: stage.kind === "memorial",
    members: ROLES.map((role, i) => {
      const member = game.members.find(m => m.role === role);
      return { role, nickname: member?.nickname ?? "합류 대기", me: role === self.role,
        done: !!mask[i], online: !!member?.online, joined: !!member,
        status: complete ? "함께 완료" : mask[i] ? `${label} 완료` : traveling ? "이동 중" : tribute ? "마음 전하는 중" : consent ? "문장 읽는 중" : closing ? "회고 중" : "조사 중" };
    }),
  };
}

// 받침 유무로 조사를 고른다. 'ㄹ' 받침은 '로'를 쓴다.
function josa(word: string, withFinal: string, without: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 ? withFinal : without;
}
function toward(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 && code % 28 !== 8 ? "으로" : "로";
}

export function expeditionStops(s: V2Response) {
  const acquired = new Set(s.game.acquired_sites.map(site => site.id));
  const results = new Set(s.self.result?.stages.map(site => site.stage_id) ?? []);
  return s.course.sites.map(site => ({ id: site.id, name: site.name,
    status: acquired.has(site.id) || results.has(site.id) || (site.id === s.stage.id && !!s.game.completion)
      ? "complete" as const : site.id === s.stage.id ? "current" as const : "upcoming" as const,
  }));
}
