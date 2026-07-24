# SPS Plugin Registry v1

이 모듈은 커뮤니티 공개 배포가 아니라 플러그인 공유를 위한 release metadata 신뢰 계약이다. Registry는 package download URL을 알려줄 수 있지만, SPS Owner Host는 반드시 release record 서명·artifact SHA-256·manifest·권한을 독립적으로 검증한다.

## 제공하는 것

- deterministic JSON canonicalization
- release record와 Registry index 구조 검사
- Ed25519 release signature 검증
- trusted source root key를 통한 Registry index signature 검증
- `.spsplugin` archive의 경로, 링크, 중복, 엔트리 수, 크기, 최상위 manifest 검사
- 실행 전 권한 미리보기를 위한 정적 `sps-plugin.json`과 runtime manifest hash 검사
- local·git·official source의 trust policy와 root key pin 검사
- `public`, `unlisted`, `private` visibility 제한
- path traversal을 막는 상대 artifact·release path 검사
- Local Registry에서 release·artifact의 실제 크기와 SHA-256 검사

## 제공하지 않는 것

- Core의 Registry disabled install·명시적 enable lifecycle
- 커뮤니티 Marketplace 계정·결제·정산
- 게시자 키 발급·보관 서비스
- Runtime 권한 우회 또는 자동 활성화

## 실행

```powershell
node --test .\registry\release-record-v1.test.mjs .\registry\local-registry-v1.test.mjs
```

다음 단계에서 Owner Host는 이 archive inspector를 사용해 설치 전 미리보기를 만들고, 안전한 extractor가 signed release의 SHA-256·크기를 추출 전후와 stream-time에 다시 확인한 뒤 disabled install만 수행한다.
