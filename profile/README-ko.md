# SPS Extension Profile v1

이 디렉터리는 Core plugin SDK 위에서 SPS 플러그인이 따르는 제품 수준 호환 표준의 첫 실행 가능한 검사기다. 새 runtime이나 새 권한 체계를 만들지 않는다.

## 검사 대상

| Profile 신호 | Core manifest 기준 | 검사 목적 |
| --- | --- | --- |
| Tool | `tools` + `agent.tools.register` | Agent 도구 등록 권한 확인 |
| Surface | `ui.slots` + `ui.*.register` + UI entrypoint | UI 확장과 bundle 선언 일치 |
| Automation | `jobs` + `jobs.schedule`, 또는 `events.subscribe` | background lifecycle 선언 확인 |
| Integration | `apiRoutes` + `api.routes.register`, 또는 `http.outbound` | 외부·API 진입점 선언 확인 |
| Workplane | `agentPlatform.kind=workplane` | Task·Agent Session 기반 작업 구조의 최소 capability 확인 |
| Store Provider | `agentPlatform.kind=store_provider` + `memoryProvider` | Memory Provider의 Core 등록 경계 확인 |

## 의도적인 제한

- 이 검사는 구조적 conformance만 확인한다. 실제 권한 판정은 Core runtime이 한다.
- 기존 플러그인은 `agentPlatform` 선언이 없어도 경고와 함께 호환 상태를 유지한다.
- Registry·Official Extensions는 이 검사 결과만으로 플러그인을 신뢰하거나 자동 활성화하지 않는다.

## 실행

```powershell
node --test .\profile\extension-profile-v1.test.mjs
```

다음 단계는 이 검사 결과를 Package validator와 Registry release inspection에 연결하는 것이다.
