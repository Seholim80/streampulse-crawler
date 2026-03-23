/**
 * StreamPulse 프론트엔드 - Supabase 연동 예시
 * 
 * Vercel StreamPulse 대시보드에서 이 코드를 사용하여
 * Supabase에 저장된 크롤링 데이터를 읽어옵니다.
 * 
 * 환경변수 (Vercel에 설정):
 *   NEXT_PUBLIC_SUPABASE_URL      - Supabase URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY - Supabase anon (public) key
 * 
 * 설치: npm install @supabase/supabase-js
 */

import { createClient } from '@supabase/supabase-js';

// anon key 사용 (읽기 전용, 클라이언트에서 안전)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============================================
// 대시보드 메인 통계
// ============================================

/**
 * 현재 라이브 방송 목록 (가장 최근 스냅샷)
 */
export async function getCurrentLives(platform?: 'chzzk' | 'soop') {
  let query = supabase
    .from('current_lives')  // 뷰 사용
    .select('*')
    .order('viewer_count', { ascending: false });

  if (platform) {
    query = query.eq('platform', platform);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * 현재 카테고리별 현황
 */
export async function getCurrentCategories(platform?: 'chzzk' | 'soop') {
  let query = supabase
    .from('current_categories')  // 뷰 사용
    .select('*')
    .order('total_viewers', { ascending: false });

  if (platform) {
    query = query.eq('platform', platform);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * 대시보드 상단 요약 카드용 데이터
 */
export async function getDashboardStats() {
  // 최근 수집 로그에서 통계 가져오기
  const { data: logs } = await supabase
    .from('collection_logs')
    .select('*')
    .eq('status', 'success')
    .order('collected_at', { ascending: false })
    .limit(2);  // chzzk, soop 각 1건

  const chzzkLog = logs?.find(l => l.platform === 'chzzk');
  const soopLog = logs?.find(l => l.platform === 'soop');

  // 전체 등록된 스트리머 수
  const { count: totalStreamers } = await supabase
    .from('streamers')
    .select('*', { count: 'exact', head: true });

  // 전체 카테고리 수 (최근 스냅샷)
  const { count: totalCategories } = await supabase
    .from('current_categories')
    .select('*', { count: 'exact', head: true });

  return {
    totalStreamers: totalStreamers || 0,
    chzzkLives: chzzkLog?.total_lives || 0,
    soopLives: soopLog?.total_lives || 0,
    chzzkViewers: chzzkLog?.total_viewers || 0,
    soopViewers: soopLog?.total_viewers || 0,
    totalCategories: totalCategories || 0,
    lastUpdated: chzzkLog?.collected_at || soopLog?.collected_at || null,
  };
}

// ============================================
// 시청자수 추이 차트용 데이터
// ============================================

/**
 * 일별 뷰어십 추이 (30일)
 */
export async function getDailyViewerTrend(days: number = 30) {
  const { data, error } = await supabase
    .from('daily_platform_stats')  // 뷰 사용
    .select('*')
    .gte('date', new Date(Date.now() - days * 86400000).toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 특정 스트리머의 시청자수 추이
 */
export async function getStreamerViewerHistory(
  platformId: string,
  hours: number = 24
) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const { data, error } = await supabase
    .from('live_snapshots')
    .select('collected_at, viewer_count, category_name, live_title')
    .eq('platform_id', platformId)
    .gte('collected_at', since)
    .order('collected_at', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 특정 카테고리의 시청자수 추이
 */
export async function getCategoryViewerHistory(
  platform: 'chzzk' | 'soop',
  categoryName: string,
  hours: number = 24
) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const { data, error } = await supabase
    .from('category_snapshots')
    .select('collected_at, total_viewers, live_count')
    .eq('platform', platform)
    .eq('category_name', categoryName)
    .gte('collected_at', since)
    .order('collected_at', { ascending: true });

  if (error) throw error;
  return data;
}

// ============================================
// Top 10 스트리머 (랭킹)
// ============================================

/**
 * 현재 시청자수 Top N
 */
export async function getTopStreamers(limit: number = 10, platform?: 'chzzk' | 'soop') {
  let query = supabase
    .from('current_lives')
    .select('platform, platform_id, channel_name, live_title, category_name, viewer_count')
    .order('viewer_count', { ascending: false })
    .limit(limit);

  if (platform) {
    query = query.eq('platform', platform);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ============================================
// 스트리머 검색
// ============================================

/**
 * 스트리머 검색 (이름으로)
 */
export async function searchStreamers(keyword: string, limit: number = 20) {
  const { data, error } = await supabase
    .from('streamers')
    .select('*')
    .ilike('channel_name', `%${keyword}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

// ============================================
// 수집 상태 모니터링
// ============================================

/**
 * 최근 수집 로그 (디버깅/모니터링)
 */
export async function getRecentCollectionLogs(limit: number = 20) {
  const { data, error } = await supabase
    .from('collection_logs')
    .select('*')
    .order('collected_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}
