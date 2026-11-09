# 🎄 크리스마스 점프 타워 (실시간 멀티플레이 영어 퀴즈 점프맵)

🌋 마그마 → 🌊 바닷속(봄) → 🍂 땅(가을) → ❄️ 하늘(겨울) → 🚀 우주(크리스마스)까지 올라가는 2D 점프맵입니다.
학생은 닉네임과 캐릭터(30종)를 골라 입장하고, 선물 상자를 먹거나 30초마다 나오는 영어 퀴즈를 풀며 꼭대기 트리까지 올라갑니다. 곳곳의 🟥 스프링을 밟으면 높이 튕겨 올라요.
교사는 `/teacher`(비밀번호 **0634**)에서 시간을 정해 시작하고, 실시간 타워·순위를 보며, 교사용 지도서 PDF로 AI 문제를 만들어 진행 중인 게임에 바로 넣을 수 있습니다.

---

## 1. 구조(아키텍처)

```
 ┌────────────── 학생 크롬북 (25대) ──────────────┐         ┌──────── 교사 PC ────────┐
 │ Phaser 3 (WebGL, 960x540, pixelArt)           │         │ teacher.html            │
 │  · 내 캐릭터 물리 = 내 브라우저에서 즉시 계산  │         │  · 시작/일시정지/±1분/종료│
 │  · 친구들 = 120ms 보간(interpolation)          │         │  · 실시간 타워·순위(4Hz) │
 │  · HUD/퀴즈 = HTML 오버레이                    │         │  · PDF 업로드·문제은행   │
 └──────┬───────────────────────▲────────────────┘         └────┬───────────▲────────┘
        │ 'm' [x,y,anim,flip]    │ 's' 델타 스냅샷 20Hz          │ REST        │ /teacher 소켓
        │ 15Hz·volatile          │ 'state' 'game:start/end'     │ (토큰)      │ 'dash' 'state' 'quiz:job'
 ┌──────▼───────────────────────┴──────────────────────────────▼───────────┴────────┐
 │ Node.js · Express 5 · Socket.io 4  (server/)                                      │
 │  game.js   : 단계(lobby/playing/ended)·타이머(endsAt)·점수·출제/채점 — 서버가 진짜  │
 │  auth.js   : 0634 → 12시간 토큰, 1분 10회 시도 제한                                │
 │  routes/admin.js : 게임 조작·결과 CSV·문제은행·PDF 업로드(multer)                  │
 │  quiz/pdf.js  : unpdf 로 쪽별 텍스트 추출(쪽 범위 지정)                            │
 │  quiz/generator.js : 영어 많은 조각 선별 → OpenAI Structured Outputs(JSON Schema)  │
 │  quiz/store.js : 문제은행(data/questions.json), 학생별 셔플 덱·보기 섞기          │
 └───────────────────────────────────────────────────────────────┬──────────────────┘
                                                                 │ HTTPS
                                                          OpenAI API (문제 생성)
```

### 렉을 없애는 설계
| 문제 | 해결 |
|---|---|
| 입력 지연 | 내 캐릭터는 클라이언트에서 바로 움직임(서버 왕복 기다리지 않음) |
| 네트워크 혼잡 | 바뀌었을 때만 15Hz 전송, `volatile`(밀린 패킷 버림), 숫자 배열만 전송, 압축(permessage-deflate) 끔 |
| 친구 캐릭터 끊김 | 서버 시각 기준 120ms 뒤를 선형 보간, 순간이동은 보간 생략 |
| 서버 부하 | 20Hz 틱에 **바뀐 플레이어만** 묶어서 1번 방송, 교사 화면은 4Hz |
| 타이머 어긋남 | 서버가 `startedAt/endsAt` 절대시각만 보내고, 각 화면은 시계 동기화(ping 6회 최소 RTT)로 계산 |
| 그래픽 로딩 | 이미지 파일 0개 — 도트 그래픽을 코드로 생성(저해상도 → 4배 확대) |
| 음악 용량·저작권 | 「Jingle Bells」(1857, 퍼블릭 도메인)를 Web Audio 칩튠으로 직접 연주 |
| 화면 밖 친구 | 그리지 않음(가시성 컬링) |

치트 방지: 정답 번호는 학생에게 미리 보내지 않고 서버가 채점, 위로 올라가는 속도 제한, 정상 도착은 서버가 위치 확인.

---

## 2. 기술 스택과 라이브러리

| 분야 | 선택 | 이유 |
|---|---|---|
| 게임 엔진 | **Phaser 3.90** (서버에서 직접 제공, CDN 불필요) | Arcade 물리, 스프라이트 애니메이션, WebGL, 크롬북에서 가벼움 |
| 실시간 통신 | **Socket.io 4.8** (websocket 전용) | 방(room)·ack·volatile·재접속 내장 |
| 서버 | **Node.js 20+ / Express 5** | 한 프로세스로 페이지·API·소켓 처리 |
| PDF 업로드 | **multer 2** (메모리 저장) | 디스크에 남기지 않음, 80MB 제한 |
| PDF 파싱 | **unpdf** (최신 pdf.js 서버 빌드) | 쪽별 텍스트, 의존성 가벼움 |
| LLM | **openai** SDK + Structured Outputs(JSON Schema, strict) | 깨진 JSON 없이 4지선다 형식 보장 |
| 설정 | dotenv | `.env`로 키·비밀번호 관리 |

---

## 3. 폴더 구조

```
xmas-jump-tower/
├─ server/
│  ├─ index.js            # Express + Socket.io 시작
│  ├─ game.js             # 게임 상태·소켓 이벤트·타이머·순위
│  ├─ auth.js             # 교사 비밀번호/토큰
│  ├─ routes/admin.js     # 교사용 REST API + PDF 작업(job)
│  └─ quiz/
│     ├─ store.js         # 문제은행(저장·중복 제거·학생별 출제)
│     ├─ generator.js     # 텍스트 → LLM → 문제
│     ├─ pdf.js           # PDF → 텍스트
│     └─ sample.js        # 기본 문제 32개(API 키 없어도 바로 플레이)
├─ public/
│  ├─ index.html, css/game.css, js/game.js      # 학생 화면(Phaser 씬)
│  ├─ teacher.html, css/teacher.css, js/teacher.js  # 교사 대시보드
│  └─ js/shared.js  js/pixelart.js  js/audio.js     # 공용 상수·맵 생성 / 도트 그래픽 / 음악
├─ test/smoke.js          # 통합 점검(모의 LLM 포함): npm test
├─ data/questions.json    # (자동 생성) 문제은행
└─ .env.example
```

---

## 4. 실행

```bash
npm install
cp .env.example .env      # OPENAI_API_KEY 입력(PDF 생성 쓸 때만 필요)
npm start                 # http://localhost:3000  ·  교사: http://localhost:3000/teacher
npm test                  # 통합 점검(학생 2명·교사·PDF→AI 흐름)
```

- 학생: `http://서버주소:3000` → 닉네임·캐릭터 → 입장(대기 중에는 연습 가능)
- 교사: `/teacher` → 0634 → 시간 설정 → **▶ 게임 시작** → 모든 화면 3·2·1 후 동시에 시작
- 조작: ⬅➡(A/D) 이동, ⬆/Space/W 점프, 공중에서 한 번 더 = 더블점프(에너지 필요), 퀴즈는 클릭 또는 1~4, M = 음악

### 배포 방법(둘 중 하나)
1. **교실 PC에서 바로**(지연 가장 적음): 교사 PC에서 `npm start` → 학생은 `http://교사PC의IP:3000`. 학교망이 기기 간 접속을 막으면 2번으로.
2. **클라우드**: Render / Railway / Fly.io 등 WebSocket 되는 Node 호스팅에 올리고 환경변수(`OPENAI_API_KEY`, `ADMIN_PASSWORD`)를 설정. 무료 요금제는 한동안 접속이 없으면 잠들 수 있으니 수업 전에 한 번 열어 두기. 서버는 **1대(인스턴스 1개)**로 운영(게임 상태가 메모리에 있음).
   - Google Apps Script는 WebSocket 서버를 돌릴 수 없어서 이 게임은 Node 호스팅이 필요해요.

---

## 5. 소켓 이벤트

| 방향 | 이벤트 | 내용 |
|---|---|---|
| 학생→서버 | `join` {name, skin, key} → ack | 입장(같은 key면 새로고침해도 점수 유지) |
| 학생→서버 | `m` [x, y, anim, flip] | 위치(15Hz, volatile) |
| 학생→서버 | `quiz:next` → ack {q} | 문제 요청(정답 미포함) |
| 학생→서버 | `quiz:answer` {id, choice} → ack | 서버 채점 결과·점수 |
| 학생→서버 | `summit` → ack | 꼭대기 도착(+1000점, 다시 처음부터) |
| 서버→학생 | `s` (t, [[sid,x,y,anim,flip]…]) | 바뀐 플레이어만, 20Hz |
| 서버→학생 | `roster:add/remove`, `count` | 입장·퇴장, 참여 인원 |
| 서버→모두 | `state`, `game:start`, `game:end` {ranking} | 단계·타이머·순위 |
| 서버→교사(`/teacher`) | `dash`(4Hz), `quiz:job` | 전체 위치·점수, PDF 생성 진행률 |

## 6. 교사용 REST (`/api/admin`, 헤더 `x-admin-token`)
`POST /login` · `GET /state` · `POST /game/start {durationSec}` · `/game/pause` · `/game/resume` · `/game/add-time {sec}` · `/game/stop` · `/game/lobby` · `GET /ranking` · `GET /results.csv` ·
`GET /quiz` · `DELETE /quiz` · `DELETE /quiz/:id` · `POST /quiz/sample` · `POST /quiz/import {questions, replace}` · `POST /quiz/upload (multipart: pdf, count, pages, grade, focus, mode)` · `GET /quiz/job/:id`

## 7. PDF → 문제 자동 생성
1. 쪽 범위(예: `210-236`)만 추출 → 쪽 번호 줄 제거
2. 약 4,500자 조각으로 나누고, **영어 단어가 많은 조각**을 최대 14개 선택(지도서의 한국어 지도 절차는 자연히 제외 → 비용 절감)
3. 조각마다 문제 수의 125%를 요청(4개 동시), JSON Schema로 형식 강제
4. 검증(보기 4개·서로 다름·정답 0~3) + 중복 제거 → **묶음이 끝날 때마다 바로 게임에 투입**
5. 학생마다 셔플 덱으로 중복 없이 출제, 다 풀면 보기 순서를 바꿔 다시 출제

모델은 `.env`의 `OPENAI_MODEL`로 바꿉니다. 글자 선택이 안 되는 스캔 PDF는 텍스트가 없어 생성되지 않아요.

## 8. 바꾸기 쉬운 값 (`public/js/shared.js`)
`ZONE_H`(구역 높이) · `PHYS`(중력·속도·점프) · `GAME.quizEvery`(자동 퀴즈 간격) · `energyDrain` · `pointsPerCorrect` · `lapBonus` · `NET.sendHz/tickHz/interpDelay`
