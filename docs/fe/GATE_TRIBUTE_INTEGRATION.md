# 정문 UI·추모의 벽 헌화 선택 통합

2026-10-11. PR #14의 최신 BE 위에 PR #15의 정문 문제 UI와 국화 놓기만 연결했다. 작업 브랜치는 `feat/gate-tribute-ui`, PR 베이스는 `feat/stage-wall-bongji`다. PR #15 전체를 병합한 작업이 아니며 두 원본 브랜치는 변경하지 않는다.

## 적용 범위

- 정문: 역할별 탭·봉투·기록첩과 서버 문항 유형에 맞는 입력을 사용한다. 코스 이름으로 화면을 제한하지 않으며 정식 검수 코스에도 같은 UI를 쓴다. 문항·선택지·필드·나레이션·힌트는 현재 Snapshot에서 읽는다. `*.legacy` 문제는 기존 UI를 유지한다.
- 추모의 벽: 전원 도착 후 각자가 국화 한 송이를 올린다. 네 명의 헌화 상태가 서버에 저장되고 마지막 헌화로 완료한다. 문제·개인 보고·공동 기록·힌트·자물쇠는 없다. 완료 후 선택형 조용한 머무르기와 지휘관의 다음 거점 이동은 유지한다.
- 용봉관: 현재 문제와 UI를 유지한다. 이후 유형이 확정되면 별도로 통합한다.
- 봉지: 기존 개인 회고·공동 기록·수정 시 전원 재동의·최종 결과를 유지한다.

사진 촬영·임베딩 판정, PR #15의 새 자동 시연·나레이션 구성 전체는 이번 범위에 포함하지 않는다. 정문 사진은 기존 승인된 임시 자료다. 새 화면은 기존 `submit-step`, `submit-report`, 힌트·해설·자물쇠 API를 이용한다. 상세 wire 계약은 [API_CONTRACT](../be/API_CONTRACT.md)다.

공개 합성 목업의 [정문 화면](images/gate-story-ui-synthetic.png)과 [헌화 화면](images/tribute-ui-synthetic.png)을 참고한다. 실제 문항이나 참가자 응답을 캡처한 것이 아니다. 수행한 검사와 미수행 항목은 [검증 기록](../../web/docs/VALIDATION.md)에 남겼다.

## 2026-10-23 정문 개인 나레이션

정문 v2는 공통 나레이션 → 본인 역할의 개인 나레이션 → 미션 순서로 진입한다. `legacy-sacho-gate` 개발 코스와 다른 거점은 기존 흐름을 유지한다. 개인 화면은 본인 `self.mission.intro`의 `enter` 본문을 우선 사용하고, 본문이 없거나 진입 장면이 아니면 본인 `self.mission.scenes`의 `enter`만 사용한다. `self.mission:null`이면 개인 화면을 띄우지 않으며 나중에 미션이 들어오면 읽지 않은 안내를 이어서 보여 준다. 타 역할의 내용을 가져오지 않는다.

공통 화면에서 계속/건너뛰기·ESC를 누르면 개인 안내로 넘어가며, 개인 안내의 마지막 버튼은 `임무 시작`이다. 버튼·ESC는 현재 화면만 닫는다. 공통·개인의 읽음 여부만 game/stage/role별 `sessionStorage`에 분리 저장하고 본문은 보관하지 않는다. 새로고침은 읽지 않은 화면부터 이어지며 안전 도착 화면을 먼저 표시한다. 나레이션 끄기는 두 화면 모두에 적용한다. 문구의 줄바꿈을 유지하고 긴 본문은 스크롤해도 종료 버튼을 누를 수 있게 표시한다.

문구는 [최신 시나리오](../scenario/GPS_MINO_1st_scenario_current.md), 필드와 공개 범위는 [API 계약 2절](../be/API_CONTRACT.md#2-콘텐츠와-공개-범위)을 따른다. API·DB 변경은 없다. 수정한 비공개 작성본으로 **새 불변 검수 코스 등록·활성화와 웹 재배포**를 해야 새 문구와 화면이 함께 반영된다. 이 나레이션 변경만을 위한 Edge 코드 변경은 없으며 아래 기존 전체 배포 스크립트를 이용할 수 있다. 이번 변경에서 클라우드 등록·활성화·배포는 수행하지 않았다.

## 새 코스가 필요한 이유

기존 등록 코스는 불변이다. 코드만 배포하면 기존 `wall.completion.type:"confirm"` 코스에는 조사·공동 기록 화면이 계속 나온다. 새 리비전 등록 시 **명시적으로 `--wall-mode tribute`**를 주면 추모의 벽 public/private 정의를 헌화로 변환한다. 정문·용봉관·봉지 문항과 기존 작성 파일은 수정하지 않는다. 변환 자체는 벽의 GPS 설정도 보존한다.

`seed:review`는 기존 규칙대로 지정 dev 프로젝트에서 전원 모의 도착인 검수 사본을 등록한다. 이 경로는 원본의 GPS 승인이나 운영 콘텐츠 확정을 대신하지 않는다. 새 `full-course` 합성 preset은 기본으로 헌화 방식을 사용한다. 과거 방과 코스는 그대로 조회·진행할 수 있다.

## 사용자가 실행할 적용 절차

이번 통합은 배포를 실행하지 않는다. PR-5까지의 기존 DB 마이그레이션이 적용되어 있어야 하며 **이번 변경에 추가 마이그레이션이나 새 비밀값은 없다.** Edge와 Vercel 웹 모두 재배포해야 한다. Vercel은 저장소 루트 archive와 기존 Root Directory=`web` 설정을 유지한다. 기존 `codex-handoff-v2/` 참조는 유지되며 새 외부 런타임 의존 파일은 없다.

커밋된 통합본과 비공개 작성 파일을 갖춘 작업 폴더의 `web/`에서 기존 스크립트에 스위치를 추가한다. 별도 worktree에는 Git에서 제외한 private 파일이 자동 복사되지 않으므로 다음 두 로컬 입력 파일을 준비해야 한다.

- `private/official-authoring/course.content.private.local.json`
- `private/official-authoring/course.answers.private.local.json`

기존 dev Vercel 연결 파일(`army/.vercel/project.json`)과 Supabase/Vercel CLI 로그인도 필요하다. 키나 환경변수 파일을 Git에 추가하지 않는다.

```powershell
# 통합본 저장소의 web/에서 실행
& .\scripts\deploy-review.ps1 -TributeWall
```

이 명령은 Vercel만 배포하는 명령이 아니다. **검수 → 새 코스 등록 → Edge → Vercel dev → 활성 코스 전환 → Edge**까지 진행한다. service_role 키와 기존 Edge와 동일한 ANSWER_SALT는 사용자가 숨김 입력한다. 실패하면 다음 단계가 중단된다. 새 ID가 출력되면 기록해 둔다. 웹 배포 이전 실패는 기존 활성 코스를 유지한다.

등록 없이 검증만 할 때에는 같은 URL·기존 salt를 사용자가 환경변수에 입력한 상태에서 아래 명령을 사용한다. 입력 경로는 실제 보유한 로컬 파일 경로로 바꿀 수 있다. `--validate-only`는 DB에 접속하지 않는다.

```powershell
npm.cmd run seed:review -- --validate-only --dev-project-ref vmadbgniurfzqygqidzw --course-id jnu-demo-dev-review-tribute-r1 --wall-mode tribute ../private/official-authoring/course.content.private.local.json ../private/official-authoring/course.answers.private.local.json
```

GPS와 운영 콘텐츠 확정 후에는 `seed:course -- --wall-mode tribute --course-id <새-운영-리비전-ID> --validate-only <콘텐츠파일> <비공개정답파일>`로 먼저 검증한다. 운영용 검증·GPS 조건은 완화하지 않는다. 검수 코스와 dev 허용 환경변수는 prod에서 사용하지 않는다.

## 배포 후 확인

새 활성 코스에서 **새 방**을 만들고 네 세션으로 확인한다.

1. 정문 공통 안내 뒤 본인 개인 안내만 보이고 `임무 시작`으로 역할별 봉투와 현재 문항에 진입하는지 확인한다. 안내 도중·완료 후 새로고침해 읽음 상태를 확인한 뒤 문제 완료·숫자 수령·보고·자물쇠가 이어지는지 확인한다.
2. 용봉관은 기존 문제와 외부 대체 모드로 진행한다.
3. 추모의 벽에서 전원 도착 전에는 헌화할 수 없는지 확인한다. 한 명이 헌화한 뒤 새로고침해도 상태가 유지되고 네 번째 헌화 후에만 `헌화 완료`로 바뀌어야 한다.
4. 추모의 벽에 공동 기록·보고·점수·자물쇠가 없어야 한다. 봉지에서는 기존 공동 기록과 회고가 보여야 한다.

실제 Supabase Realtime·실기기 GPS·클라우드 배포 후 화면은 별도로 확인해야 한다. 기존 방에서 옛 공동 기록이 보이는 것은 방의 코스 리비전이 유지되기 때문이다.
