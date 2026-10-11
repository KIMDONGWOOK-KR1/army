# 현재 게임과 BE PR #14 통합

2026-10-11. 사용자 요청: 선배가 GitHub에 올린 BE를 현재 FE 작업과 합쳐 하나의 PR로 제출한다. GitHub 게시 범위이며 운영 배포·main 병합은 수행하지 않는다.

## 기준

- 전달된 PR #8은 이미 main에 병합된 초기 FE 작업이다.
- 실제 최신 BE는 [PR #14](https://github.com/KIMDONGWOOK-KR1/army/pull/14), 검토 기준 커밋 `1a4d3973f88bbe272d6d07747278a71fbe529305`다.
- FE 기준은 `feat/story-b`의 `31c35ef`다. MINO 게임 UI, 단서 모션, 터치 드래그, 자동 시연, 정문→용봉관→추모의 벽→봉지→결과를 유지한다.
- 기존 로컬 작업 이력은 `feat/story-b`에 보존한다. 게시 브랜치는 `main` 기준 통합 결과를 한 커밋으로 정리해 예전 중간 산출물이나 정답을 설명한 과거 커밋 제목을 재게시하지 않는다.

## 반영 내용

| 영역 | 통합 결과 |
|---|---|
| 문제 제출 | 공통 method/source 생략 허용. 구형 요청에서 값이 있으면 null·형식·허용 자료 범위를 엄격히 검사 |
| 기록 전달 | 수집하지 않은 확인 방식은 null, 해설 완료만 explained. 통신원→암호해독관 개인 기록 범위 유지 |
| 봉지 공동 문장 | sentenceParts 조합을 FE 미리보기와 서버가 대조. Unicode 600자 검사, 버전 경합·멱등성·수정 후 재동의 유지 |
| 자료 사진 | 역할별 asset, 누락·실패 대체 이미지. 실제 현장 사진이 아니라는 표시. 게임의 관찰 안내에서도 표시 |
| 개발 검수 | seed:review와 PowerShell 안내를 추가. 명시적 dev 프로젝트·새 검수 코스 ID에서만 실행 가능. 이번 작업에서는 실행하지 않음 |
| 시험·계약 | API 계약과 합성 fixture 기반 시험 반영. 추모 공동 확인 API의 호환성 시험은 별도 메모리 fixture로 실행 |

## 유지하거나 제외한 내용

- 추모의 벽은 현재 구현의 묵념·국화 네 송이 헌화다. 조사 문제, 공동 문장, 점수·시간 경쟁을 추가하지 않는다.
- `course.ts`, `legacy-demo-course-v2.ts`, `yongbong-course-v2.ts`, `wall-bongji-course-v2.ts`, `legacy-full-course-v2.ts`는 1차 결과 `965239e` 및 FE 기준 `31c35ef`와 바이트가 동일하다. 보호 대상 기존 코스의 힌트 감점은 소급 변경하지 않는다. PR #14의 0/10/10은 새 합성 demo 및 새 작성 코스에 적용하는 정책이다.
- PR #14에 있는 정답 포함 시나리오 Markdown과 AGENTS 공개 예외는 가져오지 않는다. 실제 정답 JSON·salt·서비스 키·원시 GPS는 제외한다.
- 음원·3D 지도는 현재 FE 결과를 그대로 포함한다. 이번 BE 통합에서 수정하지 않는다.

## 배포 담당자 확인 사항

1. 김동욱의 검토·병합 후 Edge 함수와 FE를 함께 배포한다. 이 PR은 클라우드에 배포한 결과가 아니다.
2. 공개 환경변수에는 Supabase URL/anon key만 사용한다. 서비스 키·ANSWER_SALT를 NEXT_PUBLIC 변수로 옮기지 않는다.
3. 기존 방은 저장된 코스 리비전을 유지한다. 새 코스 활성화는 별도이며 운영 코스는 검수·GPS 확정 후 등록한다.
4. 로컬 MINO는 `LOCAL_V2_PRESET=story-b`와 비공개 판정 JSON을 사용한다. 정식 BE 작성본은 `self.mission` 응답의 type·fields를 따른다. 로컬 연출용 코스명으로 임의 개명하지 않는다.
5. 실제 사진·사용 권한, 추모의 벽 GPS, 실제 폰 네 대 현장 완주, 시간 점수·랭킹은 이번 코드 통합으로 확정하지 않는다.

## 검증

- `npx tsc --noEmit -p .`: 통과.
- `npx vitest run`: **47파일 411개 통과**.
- `NEXT_PUBLIC_BACKEND=local npm run build`: 통과.
- CI와 같은 Edge 진입점 3개의 Deno check 및 공유 모듈 15개의 Deno lint: 통과.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.integration.config.ts`: **15개 통과**. 자료 누락·실패·교체, 공동 문장 저장·수정·복원, 4인 정문, 힌트 재전송, 보직별 모바일 화면을 확인했습니다.
- Chrome·WebKit MINO 시험: **8개 시나리오 통과**. 자동 시연 완주·정지·직접 조작 복귀, 프롤로그, 독립된 네 세션의 정문→용봉관→묵념·헌화→회고·공동 동의→결과 복원입니다. 전체 실행에서 6개가 통과했고, 합성 자료의 숫자 입력 불일치를 수정한 뒤 실패했던 일반 완주 2개를 재실행해 통과했습니다. 320~430px·130% 글자와 접근성 검사가 포함됩니다.
- 최초 통합 E2E의 표시 문구 기대값과 로컬 브라우저 WebGL 문제를 조정했습니다. 검사 실패를 숨기지 않고 수정한 뒤 해당 검사를 재실행했습니다.
- 공개 대상 파일 경로·키 패턴·현재 런타임 비밀값 일치 검사에서 검출 없음. 문서 상대 링크와 `git diff --check` 통과.
- 운영 Supabase·실제 휴대폰 네 대·현장 GPS 검증은 수행하지 않았습니다. 브라우저 시험은 합성 판정 자료와 모의 도착을 사용했습니다.

### 브라우저 시험 재현

통합 UI는 `web/`에서 `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.integration.config.ts`로 검사한다. Chrome 채널 선택은 이 로컬 환경의 WebGL 지원을 위한 설정이며 CI의 기본 Playwright 브라우저는 바꾸지 않는다. 시험 방은 매번 임시 디렉터리에 만든다.

MINO 완주 시험은 `tests/helpers/story-b.ts`의 `syntheticStoryAnswers()`를 임시 비공개 JSON에 저장하고 `LOCAL_STORY_B_PRIVATE_FILE`로 지정한 뒤 `playwright.story-b.config.ts`를 실행했다. 실제 판정 JSON을 교체하지 않는다. `PLAYWRIGHT_STORY_B_URL=http://127.0.0.1:3014`를 지정해 사용자 시연 서버와 분리했다. 자동 시연 시험은 연출 시간만 가속하고 서버 요청·상태 전환은 실제 로컬 API를 사용한다.
