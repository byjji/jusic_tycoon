# 🎢 주식 타이쿤

주식 차트의 변동성을 3D 롤러코스터 레일로 변환하여, 1인칭 시점으로 주가의 흐름을 체감하는 엔터테인먼트 웹 앱입니다.

## 기능

- **차트 = 레일**: 가격이 높을수록 레일이 높아지고, 급등/급락이 곧 코스터의 언덕과 다이브가 됩니다.
- **1인칭 탑승**: 내리막(하락)에서 가속, 오르막(상승)에서 리프트 체인으로 감속 — 실제 롤러코스터 물리 모사.
- **급등(불장) 구간**: 폭죽 이펙트 + 폭죽 사운드.
- **급락 구간**: 사이렌 + 빨간 경고 비네트 + 스피드라인 + 비명 소리.
- **계기판 HUD**: 현재가, 현재 속도(km/h), 수익률, 날짜, 진행률.
- **사운드**: `sounds/` 폴더에 음원 파일(mp3/wav/ogg)을 넣으면 해당 파일을 재생하고, 없으면 Web Audio API 합성음으로 자동 대체. 필요한 파일 목록은 [sounds/README.md](sounds/README.md) 참고.
- **내리막 몰입감**: 내리막 경사·속도에 비례해 화면 주변부가 블러 처리되어(중앙은 선명) 속도감을 극대화.
- **엔딩 분기**
  - 상승 마감 → 🚀 우주로 발사
  - 하락 마감 → 💥 땅에 곤두박질치며 파괴
  - 평탄한 마감 → 🛑 정거장에 안전 정지
- **종목/기간 선택**: 텍스트 검색 + 칩으로 종목 선택, 1개월(일봉)/3개월(일봉)/1년(주봉)/3년(월봉) 기간 선택, 미니 차트 미리보기.

## 종목 데이터

GitHub Pages 같은 정적 호스팅에서는 증권사 시세 API를 호출할 수 없으므로(CORS/인증 키 필요),
명세의 대비책에 따라 아래 10개 종목의 차트를 내장 데이터로 제공합니다.

> 삼성전자, SK하이닉스, 삼성SDS, 카카오, 하이브, 셀트리온, 테슬라, 엔비디아, 비트코인, 리플

[js/data.js](js/data.js)에는 **실제 시세**(Yahoo Finance 종가, **2026-06-10 기준**)가 내장되어 있습니다.
기간별 구성: 1개월·3개월은 일봉, 1년은 주봉, 3년은 월봉.

데이터를 최신 시세로 갱신하려면 (Node.js 필요):

```
node tools/fetch-data.mjs
```

기준일은 [tools/fetch-data.mjs](tools/fetch-data.mjs)의 `AS_OF` 상수로 바꿀 수 있고,
종목을 추가하려면 같은 파일의 `TICKERS` 배열에 야후 심볼을 추가한 뒤 재실행하면 됩니다.

## 로컬 실행

ES 모듈을 사용하므로 로컬 웹 서버가 필요합니다. 프로젝트 폴더에서:

```
python -m http.server 8000
```

또는

```
npx serve
```

실행 후 브라우저에서 `http://localhost:8000` 접속.

## GitHub Pages 배포

빌드 과정이 없는 순수 정적 사이트라 그대로 올리면 됩니다.

1. GitHub에서 새 저장소 생성 (예: `jusic_tycoon`)
2. 푸시:
   ```
   git add -A
   git commit -m "주식 타이쿤"
   git branch -M main
   git remote add origin https://github.com/<내아이디>/jusic_tycoon.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages** 에서
   - Source: **Deploy from a branch**
   - Branch: **main**, 폴더: **/ (root)** 선택 후 Save
4. 1~2분 후 `https://<내아이디>.github.io/jusic_tycoon/` 에서 접속 가능

## 구조

```
index.html        # 화면 구조 (메뉴/HUD/결과/오버레이)
css/style.css     # 롤러코스터 타이쿤풍 UI 스타일
js/data.js        # 10개 종목 실제 시세 데이터 (2026-06-10 기준, 자동 생성)
tools/fetch-data.mjs # Yahoo Finance에서 시세를 받아 js/data.js 생성
js/track.js       # 차트 → 3D 레일/지지대/승강장/배경(잔디·나무·구름)
js/effects.js     # 폭죽·잔해·별 파티클
js/audio.js       # 효과음 엔진 (sounds/ 파일 우선, 없으면 합성음 폴백)
sounds/           # 음원 파일 넣는 곳 (sounds/README.md 참고)
js/ui.js          # 종목 검색/기간 선택/계기판/결과 화면
js/main.js        # 주행 물리, 카메라, 엔딩 연출, 메인 루프
```

Three.js는 CDN(importmap)으로 로드합니다.
