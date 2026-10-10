# 정식 콘텐츠 연결과 로컬 검증

2026-10-10 원문 기반 작성 데이터를 정문 → 용봉관 → 추모의 벽 → 봉지 순서로 연결했다. 이 문서는 클라우드 등록 완료 보고가 아니다. 문구·정답·힌트·숫자·개인 전달 단서를 포함한 작성 파일은 모두 Git에서 제외된 `private/official-authoring/`에 둔다. Git clone이나 Vercel 배포본에는 포함되지 않는다.

## 반영한 결정

- 정문 사건 순서는 자동 채점하고 `G-01.evidence`는 근거 자유 기록으로 수집한다. 원문에 없는 1:1 정답 짝을 만들지 않는다. 이전 코스의 match 채점은 유지한다.
- 정문·용봉관 힌트 감점은 0/10/10점, 무힌트 보너스는 0점이다. 추모·회고는 모두 0점이다.
- 실제 사진 수령 전 승인된 임시 그림을 사용한다. 정식 콘텐츠의 사진 확정이나 현장 검증으로 표시하지 않는다.
- 추모·회고 공동 기록에 `recordTemplate.sentenceParts`를 사용할 수 있다. 낱말 순서로 빈칸 문장을 조합하며 서버는 조합과 제출 문장이 일치하는지 확인한다. 이 필드가 없는 기존 코스는 자유문장 입력을 유지한다.
- 개인 기록의 공개 범위, 용봉관에서 허용된 자료 전달, 공동 기록 버전과 재동의, 최초 역할 유지, GPS 전원 도착은 기존 계약을 따른다.

## 비공개 작성 파일

| 위치 | 용도 |
|---|---|
| `private/official-authoring/gate/` | 정문 원문 변환·콘텐츠·비공개 정답 |
| `private/yongbong-authoring/` | 기존 용봉관 변환·작성 파일 |
| `private/official-authoring/closing/` | 추모의 벽·봉지 원문 변환·작성 파일 |
| `private/official-authoring/course.content.private.local.json` | 네 거점 통합 콘텐츠 입력 |
| `private/official-authoring/course.answers.private.local.json` | 같은 리비전의 비공개 정답·힌트 입력 |
| `private/official-authoring/validation.private.local.json` | 정답을 포함하지 않는 로컬 검증 결과 |

작성 파일은 검수 중인 실제 자료다. 합성 코스 등록 명령인 `seed:demo`로 등록하지 않는다. 실제 자료를 공개 fixture·브라우저 trace·테스트 실패 출력·PR에 복사하지 않는다.

## 로컬 재생성·검증

원문과 비공개 작성 도구가 있는 작업 PC의 `web/`에서 실행한다. 네트워크·DB·실제 비밀값 없이 검사한다.

```powershell
node --import=tsx ../private/official-authoring/gate/prepare.ts
node --import=tsx ../private/yongbong-authoring/prepare.ts
node --import=tsx ../private/official-authoring/closing/prepare.ts
node --import=tsx ../private/official-authoring/prepare.ts
node --import=tsx ../private/official-authoring/validate.ts
```

각 명령이 성공한 뒤 다음 명령을 실행한다. 결과는 개수·ID·검증 여부만 출력한다. 검증은 메모리 복사본에만 개발용 도착 설정과 일회용 무작위 salt를 사용한다. 실제 작성 파일·기존 코스·Edge salt는 바꾸지 않는다. 자동 검증의 정상 완료는 현장 도착 확인이나 실제 사용자 콘텐츠 검수를 뜻하지 않는다.

## 등록 전 남은 사항

- 추모의 벽 GPS 좌표는 미확정이다. 정문·용봉관·봉지는 기존 승인 좌표와 반경 10m·전원 5초 설정을 사용한다. 추모 좌표를 다른 거점으로 대체하거나 운영 도착을 우회하지 않는다.
- 원문 전사 결과의 화면·판정 검수를 마친 항목만 확정한다. 실제 정답·모의 응답을 정식 자료로 대체했다는 이유만으로 모든 `confirmed`를 일괄 변경하지 않는다.
- 출처 링크와 현장·외부 대체 자료의 대응은 원문을 기준으로 확인한다. 임시 사진 교체와 실제 휴대폰 네 대 현장 검증은 후속 작업이다.

현재 작성 파일은 `demo:false`, `confirmed:false`를 유지하며 운영 seed는 차단된다. 검수와 좌표가 준비되면 사용하지 않은 새 코스 ID를 콘텐츠 `id`와 정답 파일 `courseId`에 똑같이 지정하고, 사용자가 기존 Edge와 같은 `ANSWER_SALT`를 직접 입력하여 `seed:course --validate-only`부터 실행한다. 이후 등록·활성화·배포는 사용자 수동 단계로 진행한다.

## 코드 배포 영향

이번 공용 변경은 **Edge → 웹 재배포**가 필요하고 새 DB 마이그레이션·새 비밀값은 없다. 기존 코스는 기존 형식을 유지한다. 정식 코스 등록 전 웹 재배포만으로 실제 콘텐츠가 나타나지는 않는다. 원문·작성 파일은 웹 번들에 포함하지 않으며 새 `web/` 외부 런타임 파일 의존성도 없다.
