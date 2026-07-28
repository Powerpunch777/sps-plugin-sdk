# SPS Plugin SDK

SPS Plugin SDK는 외부 개발자가 SPS용 플러그인을 만들기 위한 공개 도구 모음이다. SPS Desktop, Host runtime, 사람 권한 정책, 사용자 데이터, 실행 Node의 제품 소스는 포함하지 않는다.

## 포함하는 것

- SPS Extension Profile v1 conformance 검사
- `.spsplugin` package, 정적 manifest, 권한 digest 규격
- Ed25519 release·Registry index 서명과 검증
- `sps-plugin` CLI: `init`, `validate`, `inspect`, `pack`, `keygen`, `release`, `registry-index`, `publish-local`
- 안전한 local Registry와 GitHub static Registry 발행 템플릿
- 검사기와 예제 기반 테스트

## 포함하지 않는 것

- SPS Core, Desktop, Host runtime, Node의 구현 코드
- 사용자 프로젝트, Room, Task, 장기기억 또는 API 키
- SPS 공식 Registry 개인 키와 공식 플러그인 코드
- 플러그인의 자동 설치·자동 활성화 권한

플러그인은 선언된 capability를 가진 package일 뿐이다. Catalog에서 항목을 선택하거나 Agent가 추천하는 일만으로 설치·활성화가 일어나지 않는다. 실제 lifecycle 변경은 SPS 제품이 제공하는 명시적 동작과 해당 Company에 활성화된 정책 플러그인에 따른다.

## 빠른 시작

Node.js 22 이상이 필요하다.

```powershell
git clone https://github.com/Powerpunch777/sps-plugin-sdk.git
cd sps-plugin-sdk
npm ci
npm test

node .\cli\sps-plugin.mjs init .\my-plugin --id com.example.my-plugin --package @example/my-plugin
node .\cli\sps-plugin.mjs validate .\my-plugin
node .\cli\sps-plugin.mjs pack .\my-plugin --out .\release\my-plugin.spsplugin
```

## 호환성

이 SDK는 SPS Plugin API v1과 SPS Desktop 0.4 계열의 package·Registry 계약을 대상으로 한다. 현재 `init` 템플릿에는 호환 Core가 요구하는 `paperclipPlugin` manifest 속성이 남아 있다. 이는 SPS 제품의 이름이나 권한 경계를 의미하지 않는 **v0.1 호환 필드**이며, SPS 전용 runtime manifest가 안정화되면 versioned migration으로 교체한다.

Plugin author는 자신의 플러그인 코드와 라이선스를 소유한다. `SPS`, SonParkServer, 공식 배지와 공식 Registry 명칭은 별도 상표·이용 정책의 대상이며, 이 SDK 라이선스가 이를 부여하지 않는다.

## 보안

- 개인 키, `.env`, credential 파일을 package나 Git에 넣지 마세요.
- `publish-local`과 static Registry template은 release와 index를 따로 서명합니다.
- Registry나 catalog 정보는 자동 설치·실행·사람 권한을 부여하지 않습니다.
- 취약점은 공개 Issue에 올리지 말고 [SECURITY.md](SECURITY.md)의 절차를 따르세요.

## 피드백과 기여

- SDK 사용 경험과 확장 설계 의견은 GitHub Discussions에서 받습니다.
- 재현 가능한 SDK·CLI 오류만 GitHub Issue로 등록합니다.
- 제품 로그, 초대 코드, API 키, 개인 프로젝트 파일은 공개 글에 올리지 않습니다. 자세한 기준은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따릅니다.

## 라이선스

SDK 소스는 [Apache-2.0](LICENSE)입니다. 번들 의존성의 고지는 [NOTICE.md](NOTICE.md)에 정리합니다.
