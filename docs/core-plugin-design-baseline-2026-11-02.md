# Core와 Plugin의 SDK 설계 경계

2026-11-02. 사용자 제공 Core–Plugin 아키텍처에 맞춘 개발 목표다.
새 API 출시·구현 완료·라이선스 변경 또는 개발 자동 재개 선언이 아니다.
README는 이번 문서 정렬 범위에서 제외한다.

## 선택형 기술 계약

- Core는 인증·사용자/Workspace 접근, Host/Node·범용 실행·저장·Event/Job·Artifact·생명주기·보안·복구를 소유한다.
- Plugin은 업무·프로젝트·역할·승인·대화·기억·협업과 UI를 소유한다.
- AI·Agent·Builder·Task·Dashboard·Inbox·공통 메뉴는 모든 Plugin의 필수 조건이 아니다.
- 빈 Workspace와 UI 없는 Plugin을 허용한다. Host 설치와 Workspace별 활성/데이터를 분리한다.
- Primary는 Workspace 기본 진입 지정0~1개이지 권한 등급이 아니다. Extension도 전체 UI·창·헤드리스가 가능하다.
- Plugin 화면에 Core 상단바/사이드바/Settings 버튼을 강제하지 않는다.
- Core 관리는 Plugin 코드 없이 Native 트레이·단축키·독립 Settings에서 가능해야 한다.
- SDK 설정 열기·Preview lifecycle는 선택형 편의 계약 목표다. 예시 이름을 실제 export로 오인하지 않는다.

## 보안과 수명주기

capability 선언은 사용자/Host/Workspace/Source/Runner 권한 부여가 아니다.
Plugin 자유도는 Core Vault·타 Workspace·관리자 정책을 우회할 권한이 아니다.
선택적 최대 파일 범위는 Plugin·CLI·스크립트·자식에 실제 집행해야 한다.
같은 사용자 Worker·DPAPI·Job·API 경로 검사만으로 OS 보호를 증명하지 않는다.
미지원 실행을 보호된 것처럼 표시하거나 자동 대체하지 않는다.

pause/stop/resume과 실제 종료를 구분하고 취소/불확실 요청을 자동 재생하지 않는다.
업데이트 자동 확인과 사용자 적용을 분리한다. 의존 Plugin도 승인 없이 설치·활성화하지 않는다.
기본 초기화는 현재 Workspace+Plugin만 대상이며 다른 Plugin·외부 프로젝트는 보호한다.
목표 백업은 관리 데이터/설치 상태를 보존하며 인증정보는 기본 제외·재연결한다.
자원 관찰은 공유 비용을 구분하며 자동 CPU/RAM 강제 상한을 뜻하지 않는다.

## 제작과 Preview

공개 범용 Builder는 선택형 제작 경로다. 외부 IDE/SDK CLI/다른 Builder도 사용할 수 있다.
Lead3·프로젝트 CTO 단일 세션·독립 Dev/QA·GitHub Runner는 한 Builder 워크플로의 설계다.
Core 필수 역할이나 SDK의 유일한 사용 패턴으로 만들지 않는다.
Preview는 Builder 독점이 아닌 공통 격리 개발 기반이며 실제 Workspace/데이터와 분리한다.
Marketplace·검사/배지는 후속 목표이며 절대 안전 보장이나 자동 설치 권한이 아니다.
SDK 기존 라이선스는 유지한다. Builder/Preview 라이선스와 판매·수익 계약은 별도 결정한다.

## 구현 문서의 해석

현재 exports·타입·RPC·호환성과 실제 source revision을 확인한 뒤 사용한다.
이 설계는 없는 API를 만들거나 구버전 Host 지원을 보장하지 않는다.
기존 계약을 즉시 삭제하지 않고 폐기·이전·롤백 경로를 설계한다.
기술 문서·메모리 mock·OS 실증·실제 앱/설치본/두 PC 증거를 구분한다.
현재 API는 [세션/액션 계약](platform-actions-and-sessions.md) 등을 따른다.
원문 식별: SPS_Core_Plugin_Architecture_Handoff_2026-10-25.md,
SHA256 8e77fb84439ab1f8779cca86bd35cabf2bdee497a706bfa4912f7523e26f9a77.
비공개 Core 소스·사용자 데이터·자격증명은 이 공개 문서에 복사하지 않는다.
