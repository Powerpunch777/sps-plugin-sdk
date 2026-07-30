# SPS Plugin Registry

Registry는 SPS Plugin package의 release metadata를 제공하는 배포 목록이다. Registry를
추가하거나 Catalog에서 항목을 보는 일은 Plugin의 설치·활성화·실행 권한을 뜻하지
않는다.

## 제공하는 검증

- 결정적인 JSON canonicalization
- Ed25519 publisher release와 Registry index 서명
- `.spsplugin` archive의 경로, 크기, 중복, hash, manifest 검사
- static manifest와 release record의 capability digest 비교
- Local, Git, Official source의 trust policy와 root key pin 검사
- artifact와 release의 SHA-256 재확인

## 제공하지 않는 것

- 자동 설치, 자동 활성화, 자동 실행
- Marketplace 계정, 결제, 판매, 정산
- 공개 업로드 심사나 커뮤니티 신고 서비스
- Host 폴더, Runtime 계정, Secret에 대한 접근 권한

## 사용 흐름

1. 작성자가 Plugin을 package하고 publisher key로 release record를 서명한다.
2. Registry 관리자가 release 목록을 root key로 서명한다.
3. SPS Desktop은 source trust, release signature, hash, 호환성을 확인한다.
4. Host가 package를 stage하고, 선택한 Workspace에 활성화할지 결정한다.

Local Development Registry는 개인 Plugin의 테스트 경로다. Official Registry는 별도의
검증·서명 정책을 따르며, 첫 출시에는 공개 self-service upload나 판매 기능을 제공하지
않는다.
