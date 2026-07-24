# GitHub Static Registry 발행 템플릿

`github-static-registry-publish.yml`은 한 저장소 안에 **SPS Plugin SDK, 플러그인 source, 정적 Registry 폴더**가 함께 있을 때 쓰는 수동 GitHub Actions 템플릿이다. 이 단계는 커뮤니티 Marketplace가 아니라, 서명된 불변 release 파일을 정적 호스팅으로 배포하기 위한 Registry 운영 도구다.

## 먼저 준비할 것

1. 이 파일을 대상 저장소의 `.github/workflows/sps-registry-publish.yml`로 복사한다.
2. 대상 저장소 root에 SPS Plugin SDK가 있어야 한다. SDK를 npm package로 설치하는 방식은 별도 배포 단계에서 제공한다.
3. 보호된 branch를 사용한다. Registry 파일을 수정할 수 있는 사람은 게시 권한을 가진 사람뿐이어야 한다.
4. GitHub Actions Secret 두 개를 만든다.
   - `SPS_REGISTRY_PUBLISHER_PRIVATE_KEY`: release record에 서명하는 Ed25519 PEM 개인 키
   - `SPS_REGISTRY_ROOT_PRIVATE_KEY`: `registry.json` index에 서명하는 Ed25519 PEM 개인 키

개인 키는 플러그인 source, `.spsplugin`, Registry 폴더, Git 커밋, Actions log에 넣지 않는다. 최초 발행의 Action 출력에 나타나는 **공개 root key**와 key ID만 SPS Desktop의 remote source 설정에 고정한다.

## 발행 흐름

1. Actions에서 `Publish SPS Static Registry`를 수동 실행한다.
2. 플러그인 source와 Registry 폴더, Registry·Publisher·key ID를 입력한다.
3. Action이 Secret을 runner의 임시 파일에만 기록하고 `publish-local`을 실행한다.
4. 생성된 archive, immutable release record, `registry.json`을 `inspect`로 다시 검증한다.
5. 검증에 성공한 Registry 폴더만 커밋·push한다.
6. 그 폴더를 GitHub Pages, Cloudflare R2/Pages, 또는 다른 HTTPS 정적 호스트로 제공한다. Desktop에는 해당 `registry.json` URL과 최초 공개 root key를 함께 등록한다.

Registry의 index는 새 release가 생길 때 갱신되지만, `packages/<plugin>-<version>.spsplugin`과 `releases/<plugin>-<version>.json`은 절대 덮어쓰지 않는다. `publish-local`이 기존 version을 거부하는 이유다.

## 이 템플릿이 하지 않는 일

- 커뮤니티 Marketplace 검색, 리뷰, 판매, 정산, entitlement 발급
- 권한 자동 승인이나 자동 enable
- Secret 없는 임시 키 생성
- production Registry의 호스트·도메인 구성

따라서 커뮤니티 Marketplace는 이 템플릿으로 만든 실제 Registry를 최소 한 번 배포하고, Desktop의 source 등록부터 stage·enable·update·rollback까지 반복 검증한 뒤에만 검토한다.
