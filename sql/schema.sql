-- ============================================
-- StreamPulse DB Schema for Supabase
-- 실행: Supabase SQL Editor에 붙여넣기 후 Run
-- ============================================

-- 1. 스트리머 마스터 테이블
CREATE TABLE IF NOT EXISTS streamers (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'soop')),
  platform_id TEXT NOT NULL,          -- 치지직: channelId (해시), SOOP: bjId
  channel_name TEXT NOT NULL,
  channel_image_url TEXT,
  follower_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, platform_id)
);

-- 2. 라이브 스냅샷 (핵심 테이블: 30분마다 쌓임)
CREATE TABLE IF NOT EXISTS live_snapshots (
  id BIGSERIAL PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'soop')),
  platform_id TEXT NOT NULL,           -- streamers.platform_id 참조
  channel_name TEXT NOT NULL,
  live_title TEXT,
  category_id TEXT,
  category_name TEXT,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  accumulate_count INTEGER DEFAULT 0,  -- 누적 시청자 (치지직)
  is_live BOOLEAN DEFAULT TRUE,
  open_date TIMESTAMPTZ,               -- 방송 시작 시간
  extra_data JSONB DEFAULT '{}'::JSONB  -- 기타 메타데이터
);

-- 3. 카테고리별 집계 스냅샷
CREATE TABLE IF NOT EXISTS category_snapshots (
  id BIGSERIAL PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform TEXT NOT NULL CHECK (platform IN ('chzzk', 'soop')),
  category_id TEXT,
  category_name TEXT NOT NULL,
  live_count INTEGER NOT NULL DEFAULT 0,
  total_viewers INTEGER NOT NULL DEFAULT 0,
  top_streamer_name TEXT,
  top_streamer_viewers INTEGER DEFAULT 0
);

-- 4. 수집 로그 (디버깅/모니터링용)
CREATE TABLE IF NOT EXISTS collection_logs (
  id BIGSERIAL PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform TEXT NOT NULL,
  total_lives INTEGER DEFAULT 0,
  total_viewers INTEGER DEFAULT 0,
  total_categories INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success',
  error_message TEXT
);

-- ============================================
-- 인덱스 (쿼리 성능 최적화)
-- ============================================

-- live_snapshots: 시간순 조회, 플랫폼별 필터링
CREATE INDEX IF NOT EXISTS idx_live_snapshots_collected 
  ON live_snapshots (collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_snapshots_platform_time 
  ON live_snapshots (platform, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_snapshots_category 
  ON live_snapshots (platform, category_name, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_snapshots_streamer 
  ON live_snapshots (platform_id, collected_at DESC);

-- category_snapshots: 카테고리별 추이
CREATE INDEX IF NOT EXISTS idx_category_snapshots_time 
  ON category_snapshots (collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_category_snapshots_platform 
  ON category_snapshots (platform, category_name, collected_at DESC);

-- streamers: 검색
CREATE INDEX IF NOT EXISTS idx_streamers_platform 
  ON streamers (platform, channel_name);

-- ============================================
-- RLS (Row Level Security) - Public Read Only
-- ============================================

ALTER TABLE streamers ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_logs ENABLE ROW LEVEL SECURITY;

-- 읽기는 누구나 가능 (대시보드에서 anon key로 읽기)
CREATE POLICY "Public read streamers" ON streamers 
  FOR SELECT USING (true);
CREATE POLICY "Public read live_snapshots" ON live_snapshots 
  FOR SELECT USING (true);
CREATE POLICY "Public read category_snapshots" ON category_snapshots 
  FOR SELECT USING (true);
CREATE POLICY "Public read collection_logs" ON collection_logs 
  FOR SELECT USING (true);

-- 쓰기는 service_role만 가능 (크롤러에서 service key 사용)
CREATE POLICY "Service write streamers" ON streamers 
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update streamers" ON streamers 
  FOR UPDATE USING (true);
CREATE POLICY "Service write live_snapshots" ON live_snapshots 
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service write category_snapshots" ON category_snapshots 
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service write collection_logs" ON collection_logs 
  FOR INSERT WITH CHECK (true);

-- ============================================
-- 자동 정리 함수 (30일 이상 된 스냅샷 삭제)
-- Supabase SQL Editor에서 수동 실행하거나
-- pg_cron으로 스케줄링 가능
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_snapshots()
RETURNS void AS $$
BEGIN
  DELETE FROM live_snapshots 
    WHERE collected_at < NOW() - INTERVAL '90 days';
  DELETE FROM category_snapshots 
    WHERE collected_at < NOW() - INTERVAL '90 days';
  DELETE FROM collection_logs 
    WHERE collected_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 유용한 뷰 (대시보드에서 바로 쓸 수 있는 집계)
-- ============================================

-- 최근 수집된 라이브 방송 (현재 방송중)
CREATE OR REPLACE VIEW current_lives AS
SELECT ls.* FROM live_snapshots ls
INNER JOIN (
  SELECT platform, MAX(collected_at) AS latest
  FROM live_snapshots
  GROUP BY platform
) latest_per_platform 
ON ls.platform = latest_per_platform.platform 
AND ls.collected_at = latest_per_platform.latest
ORDER BY ls.viewer_count DESC;

-- 카테고리별 현재 현황
CREATE OR REPLACE VIEW current_categories AS
SELECT cs.* FROM category_snapshots cs
INNER JOIN (
  SELECT platform, MAX(collected_at) AS latest
  FROM category_snapshots
  GROUP BY platform
) latest_per_platform 
ON cs.platform = latest_per_platform.platform 
AND cs.collected_at = latest_per_platform.latest
ORDER BY cs.total_viewers DESC;

-- 일별 플랫폼 통계
CREATE OR REPLACE VIEW daily_platform_stats AS
SELECT 
  DATE(collected_at) AS date,
  platform,
  MAX(total_lives) AS peak_lives,
  MAX(total_viewers) AS peak_viewers,
  AVG(total_viewers)::INTEGER AS avg_viewers,
  COUNT(*) AS collection_count
FROM collection_logs
WHERE status = 'success'
GROUP BY DATE(collected_at), platform
ORDER BY date DESC;
