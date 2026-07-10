# Current Task

## 적용 기준

- 기준 current: `railmap13.70.0-current.zip`
- 선행 반영: `13.71.0-editor-maintenance-workflow`
- 현재 묶음: `13.72.0-13.74.0`

## 이번 묶음

### 13.72.0 경로검색 회귀 기준

- 공개 웹 결과를 브라우저 회귀 기준으로 저장
- 같은 출발·도착 검색 시 시간, 환승, 경유 순서 비교
- 변경 확인 필요/기준 통과 표시

### 13.73.0 데이터 콘텐츠 해시

- bundle 및 manual overlay SHA-256 생성
- release ID 생성
- manifest schema 2 적용

### 13.74.0 운영 정리

- 웹 데이터 버전 tooltip에 release/hash 표시
- 오래된 `.bak` 파일 제거 대상으로 정리
- 관련 운영 문서 최신화

## 다음 후보

- 시간표 CSV 대량 미매칭 일괄 보정
- 회귀 검증 케이스 가져오기/내보내기 및 일괄 실행
- 배포 캐시 헤더와 release 불일치 경고
- 운임 모델 기반
