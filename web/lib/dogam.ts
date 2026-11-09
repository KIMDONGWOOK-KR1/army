// 안 2 '현장 도감'(hh 2026-11-08). 거점마다 도감 한 장: 네 보직이 도구 하나씩 들고 현장의 실제 대상을 찾아 칸을 채운다.
// 이 파일은 화면에 보여 줄 칸 이름·도구·그림·안내만 갖는다. 정답·채널·숫자·이야기(해설)는 서버에서만 온다.
import type { Role, Step } from "@/supabase/functions/_shared/types";

export type DogamTool = "binoculars" | "rubbing" | "radio" | "compass";
export type DogamArtId = "bloom" | "stone" | "miniGate" | "roadFlag";
export type DogamPicture = "gate";

export type DogamSlot = {
  role: Role;
  num: string;
  tool: DogamTool;
  toolName: string;
  /** 보직 소개 한 줄(도감 첫 화면·칸 아래) */
  toolLine: string;
  name: string;
  art: DogamArtId;
  /** 이 보직의 도감 문항 수(공개 구조, 답 아님). 서버가 보직별 문항 수를 주지 않는 판에서 동료 칸이 찼는지 셀 때 쓴다. */
  steps: number;
  /** 도구 화면 첫 줄: 무엇을 찾는지 */
  goal: string;
  /** 현장에서는 어떻게 하는지(시연 그림은 예시) */
  field: string;
  /** 진짜 카메라·나침반으로 할 때의 첫 줄과 아랫줄(hh 2026-11-08) */
  liveGoal: string;
  liveField: string;
  /** 고르기 문항을 그림으로 보여 줄 때(선택지 순서대로) */
  pictures?: Record<string, { art: DogamArtId; alt: string }[]>;
};

export type DogamPage = {
  stageId: string;
  title: string;
  place: string;
  intro: string;
  slots: DogamSlot[];
  hidden: { label: string; note: string; toast: string };
  picture: DogamPicture;
};

export const DOGAM_PAGES: Record<string, DogamPage> = {
  gate: {
    stageId: "gate",
    title: "정문 도감",
    place: "정문",
    intro: "네 보직이 도구 하나씩 들고 정문 둘레의 실제 대상을 찾아 도감 네 칸을 채워요. 답은 화면이 아니라 눈앞의 장소에 있어요.",
    slots: [
      {
        role: "scout", num: "①", tool: "binoculars", toolName: "불꽃 찾기", toolLine: "표지석 불꽃을 비춰요",
        name: "표지석 불꽃", art: "stone", steps: 1,
        goal: "길 건너편의 꽃 모양 조형물을 찾아요. 끌어서 둘러보고, 두 손가락으로 벌리거나 배율을 눌러 당겨요.",
        field: "현장에서는 눈앞의 길 건너편을 봐요. 그림은 예시예요.",
        liveGoal: "길 건너편 꽃 모양 조형물을 카메라로 찾아 당겨요. 잠깐 멈추면 찍혀요.",
        liveField: "찍은 사진은 이 폰의 도감에만 붙고, 어디에도 올라가지 않아요.",
      },
      {
        role: "cipher", num: "②", tool: "rubbing", toolName: "기록실 금고", toolLine: "쪽지·편지를 풀어 금고 번호를 찾아요",
        name: "5·18 사적지 표지석", art: "stone", steps: 1,
        goal: "표지석에 종이를 대고 손가락으로 문질러요. 새긴 글자가 하얗게 떠올라요.",
        field: "현장에서는 눈앞의 표지석을 봐요. 글자 모양은 예시예요.",
        liveGoal: "표지석 글자를 틀에 맞춰 찍고, 탁본 종이를 손가락으로 문질러요.",
        liveField: "사진은 이 폰에만 남아요. 표지석은 손으로 만지지 않아도 돼요.",
      },
      {
        role: "signal", num: "③", tool: "radio", toolName: "무전기", toolLine: "채널을 맞춰 무전을 들어요",
        name: "1980년 문 모형", art: "miniGate", steps: 1,
        goal: "지휘관이 불러 주는 채널로 다이얼을 맞춰요. 맞으면 기록실 무전이 들려요.",
        field: "현장에서는 지휘관이 채널을 말로 불러 줘요. 무전은 내 폰에만 들려요.",
        liveGoal: "지휘관이 불러 주는 채널로 다이얼을 맞춰요. 무전을 들은 뒤 폰을 돌려 신호가 오는 쪽을 찾아요.",
        liveField: "소리를 켜 두면 잡음이 걷히는 게 들려요. 무전은 내 폰에만 들려요.",
        pictures: {
          "G-03.dogam": [
            { art: "bloom", alt: "가, 꽃 모양 조형물 그림" },
            { art: "miniGate", alt: "나, 쇠창살 문 그림" },
            { art: "stone", alt: "다, 비석 그림" },
          ],
        },
      },
      {
        role: "commander", num: "④", tool: "compass", toolName: "정문 퀴즈", toolLine: "세 문제로 정문을 짚어요",
        name: "정문 퀴즈", art: "roadFlag", steps: 3,
        goal: "길 끝의 용봉관 쪽으로 깃발을 겨눠요. 지도를 누르거나 끌면 깃발이 그쪽으로 돌아요.",
        field: "현장에서는 깃발 끝을 따라 진짜 길 끝을 봐요.",
        liveGoal: "카메라 화면에 뜬 용봉관 쪽 깃발을 가운데 줄에 맞춰 길 위에 꽂아요.",
        liveField: "나침반은 조금씩 틀릴 수 있어요. 깃발을 꽂은 뒤 길 끝을 눈으로 따라가 봐요.",
      },
    ],
    hidden: {
      label: "숨은 칸 · 누구나",
      note: "2026년에 생긴 곳에서 찾아요",
      toast: "숨은 칸은 현장에서 열려요. 정문 근처에서 2026년에 생긴 곳을 찾아봐요.",
    },
    picture: "gate",
  },
};

/** '.dogam' 또는 '.dogam-…'으로 끝나는 문항이 도감 문항이다(서버 코스 dogam-course-v2.ts). */
export const isDogamStep = (id: string) => /\.dogam(?:-[a-z0-9-]+)?$/.test(id);

export function dogamPageFor(stageId: string, steps: readonly Step[] | undefined): DogamPage | null {
  const page = DOGAM_PAGES[stageId];
  return page && !!steps?.length && steps.every((step) => isDogamStep(step.id)) ? page : null;
}

export const dogamSlotFor = (page: DogamPage, role: Role) =>
  page.slots.find((slot) => slot.role === role)!;

/** 동료 칸이 찼는지: 공개 개수(푼 문항 수)만 보고, 남의 문항 내용은 보지 않는다.
 * 보직별 전체 문항 수는 서버가 주면 그 값을, 안 주는 판(맥 엔진)에서는 도감 칸의 문항 수를 쓴다. */
export function dogamSlotDone(
  game: { step_done_count: Partial<Record<Role, number>>; step_total_count?: Partial<Record<Role, number>> },
  slot: DogamSlot,
) {
  const total = game.step_total_count?.[slot.role] ?? slot.steps;
  return total > 0 && (game.step_done_count[slot.role] ?? 0) >= total;
}

/** 넷이 한 그림: 조각이 처음 돌아가 있는 각도(보직마다 다르게, 정답과 무관). */
export const PIECE_START_TURN: Record<Role, number> = {
  commander: 180,
  scout: 90,
  signal: 270,
  cipher: 90,
};
