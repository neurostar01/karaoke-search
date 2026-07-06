# 노래방 번호검색 🎤

TJ미디어·금영 노래방 곡번호를 곡명 또는 가수로 검색하는 모바일 웹앱.

## 구조

- `index.html` — 프런트엔드 전체 (단일 파일)
- `api/search.js` — Vercel 서버리스 함수. 공식 사이트를 서버에서 조회·파싱해 JSON으로 반환
  - TJ: `www.tjmedia.com/song/accompaniment_search` (HTML 파싱)
  - 금영: `kysing.kr/search/` (HTML 파싱)
  - 폴백: 공식 조회 실패 또는 0곡이면 `api.manana.kr`(비공식)로 교차 확인

## 배포

Vercel에 GitHub 저장소를 연결하면 끝 (빌드 설정 불필요, Other/정적 프레임워크).
`main` 푸시 시 자동 재배포.

## API

`GET /api/search?q=사계&mode=song|singer&brand=all|tj|kumyoung`

공식 사이트 마크업이 바뀌면 `api/search.js`의 `parseTJ` / `parseKY` 정규식을 수정할 것.
