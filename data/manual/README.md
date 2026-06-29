# Manual Overlays

수동 보정 데이터는 공공 원본 데이터를 직접 수정하지 않고 이 파일에서 관리한다.

현재 지원 데이터:

- `manualTransferEdges`: 역과 역 사이의 수동 환승 연결

웹 개발 서버에서 `/manual-transfer-editor`로 접속해 환승 edge를 추가, 수정, 삭제할 수 있다.
변경 내용은 `apps/web/public/data/manual-overlays.json`과 `data/manual/manual-overlays.json`에 함께 저장된다.
