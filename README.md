# StreamPulse Crawler

## 📌 개요
StreamPulse 대시보드(https://stream-pulse-three.vercel.app/)에 데이터를 공급하는 자동 수집 시스템입니다.

**구조:**
```
GitHub Actions (30분마다 자동 실행)
    ↓
Chzzk API + SOOP API 크롤링
    ↓
Supabase (PostgreSQL, 무료)
    ↓
Vercel StreamPulse 대시보드
```

**비용: $0** (모든 서비스 무료 티어 사용)

---

## 🚀 세팅 가이드 (10분)

### Step 1: Supabase 프로젝트 생성
1. https://supabase.com 가입 → New Project 생성
2. **Project Settings > API** 에서 다음 값 복사:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_SERVICE_KEY` (service_role secret key)
3. **SQL Editor** 에서 `sql/schema.sql` 내용을 복사 붙여넣기 후 실행

### Step 2: GitHub 레포지토리 생성
1. https://github.com/new → **Public** 레포로 생성 (무료 Actions 무제한)
2. 이 폴더의 파일들을 모두 push
3. **Settings > Secrets and variables > Actions** 에서 시크릿 추가:
   - `SUPABASE_URL` → Step 1에서 복사한 URL
   - `SUPABASE_SERVICE_KEY` → Step 1에서 복사한 키

### Step 3: 자동 실행 확인
- Push 후 자동으로 첫 수집이 실행됩니다
- **Actions** 탭에서 실행 결과 확인
- 이후 30분마다 자동 실행

### Step 4: Vercel StreamPulse에 Supabase 연결
- Vercel 대시보드 > Settings > Environment Variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon public key)

---

## 📊 수집 데이터

### Chzzk (치지직)
- **엔드포인트**: `api.chzzk.naver.com`
- **수집 항목**: 라이브 방송 목록, 시청자수, 카테고리, 방송 제목
- **방식**: 카테고리별 검색 API → 전체 라이브 목록 순회

### SOOP (숲)
- **엔드포인트**: `live.sooplive.co.kr`
- **수집 항목**: 라이브 방송 목록, 시청자수, 카테고리, 방송 제목
- **방식**: player_live_api + 방송 목록 API

---

## 📁 파일 구조
```
streampulse-crawler/
├── .github/workflows/
│   └── collect.yml          # GitHub Actions 스케줄러
├── src/
│   ├── index.ts             # 메인 진입점
│   ├── chzzk-collector.ts   # 치지직 수집기
│   ├── soop-collector.ts    # SOOP 수집기
│   └── supabase-client.ts   # DB 클라이언트
├── sql/
│   └── schema.sql           # Supabase 테이블 생성 SQL
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚠️ 주의사항
- Chzzk/SOOP 비공식 API는 과도한 요청 시 IP 차단 가능
- 수집 주기 30분은 안전한 수준 (소프트콘은 6분이지만 EC2 사용)
- Supabase Free: 500MB 제한, 7일 비활성 시 일시정지 (크롤러가 돌면 OK)
- GitHub Actions Public repo: 완전 무료, 무제한
