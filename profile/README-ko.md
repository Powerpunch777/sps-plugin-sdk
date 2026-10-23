# SPS Extension Profile

SPS Extension Profile은 플러그인 manifest가 SPS Core와 호환되는지 검사하는 공개
규격이다. 이 규격은 특정 업무 방식, 사용자 권한 체계, 자동 설치 규칙을 만들지
않는다.

## Profile 1.0

Profile 1.0은 기존 SPS/Paperclip 계열 플러그인을 위한 호환 경로다. 기존 패키지를
옮길 때만 사용하고, 새 플러그인은 Profile 2.0을 사용한다.

## Profile 2.0

Profile 2.0은 업무 방식에 종속되지 않는 SPS Core 경계를 정의한다. 플러그인은 필요한
기술 primitive만 선언할 수 있다.

- Host가 관리하는 Workspace Source의 메타데이터와 보호된 route
- 승인된 Node가 제공하는 Runtime 목록과 dispatch 요청
- Node 및 Agent Session lane을 아우르는 읽기 전용 execution 이력 관찰
- SPS dispatch Run 상태 관찰과 취소, Artifact 작성, Secret reference

`executions.observe` primitive은 `sps.executions.read` capability를 요구한다.
Execution 이력의 `reported` 사용량은 adapter가 보고한 값이며 실제 청구로 검증된
값이 아니다. `unavailable`은 0을 뜻하지 않는다. 명시적 근거가 없는 과거 이력은
사용량을 추정하지 않고 unavailable로 유지한다. `subscription_reference` 비용도 실제
청구액이 아니라 구독 기준 참고값일 수 있다.

Profile 2.0은 Task, Room, 역할 체계, 승인 절차, 장기기억 정책을 정의하지 않는다.
그런 업무 의미는 Plugin이 직접 정의한다.

Manifest 선언만으로는 Plugin 설치·활성화, Host 폴더 접근, 계정 자격 증명 전달,
Secret 열람이 일어나지 않는다. Host가 SPS Desktop에서 명시적으로 신뢰, stage,
Workspace 활성화를 결정해야 한다.

## 검사

```powershell
npm test
```

`extension-profile-v2.mjs`는 정적 선언을 검사한다. 실제 실행 권한과 데이터 접근은
SPS Core와 활성화된 Plugin의 별도 계약에서 다시 확인한다.
