# SPS Extension Profile

SPS Extension Profile은 Core plugin manifest 위에서 동작하는 공개 호환성
검사 규격입니다. 이 규격은 새로운 실행 런타임이나 권한 체계를 만들지
않습니다.

## v1

v1은 기존 SPS와 Paperclip 호환 플러그인을 검사합니다. 기존 플러그인을
깨지 않기 위해 유지됩니다.

## v2

v2는 작업 방식과 독립적인 SPS Core 경계를 검사합니다.

- Host가 관리하는 Workspace Source의 메타데이터와 연결 경로
- 이 컴퓨터나 승인된 Node에 공개된 Runtime 목록과 실행 요청
- Run 상태 확인, Artifact 작성, Secret 참조

v2는 Task, Room, 역할 체계, 승인 절차, 장기기억 방식을 정의하지
않습니다. 이런 업무 의미는 플러그인이 정의합니다. Manifest에 적힌
선언만으로는 플러그인이 설치되거나 활성화되지 않으며, Host 폴더 경로,
계정 자격 증명, Secret이 전달되지 않습니다.

## 실행

```powershell
npm test
```
