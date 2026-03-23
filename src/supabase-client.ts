/**
 * Supabase 클라이언트
 * - service_role key 사용 (RLS 우회, 쓰기 권한)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_KEY를 설정해주세요.\n' +
    'GitHub Actions: Settings > Secrets에 추가\n' +
    '로컬 테스트: .env 파일 생성'
  );
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ============================================
// DB 삽입 헬퍼 함수들
// ============================================

export interface LiveSnapshot {
  platform: 'chzzk' | 'soop';
  platform_id: string;
  channel_name: string;
  live_title: string | null;
  category_id: string | null;
  category_name: string | null;
  viewer_count: number;
  accumulate_count: number;
  is_live: boolean;
  open_date: string | null;
  extra_data: Record<string, unknown>;
}

export interface CategorySnapshot {
  platform: 'chzzk' | 'soop';
  category_id: string | null;
  category_name: string;
  live_count: number;
  total_viewers: number;
  top_streamer_name: string | null;
  top_streamer_viewers: number;
}

/**
 * 라이브 스냅샷 일괄 삽입
 */
export async function insertLiveSnapshots(snapshots: LiveSnapshot[]) {
  if (snapshots.length === 0) return;

  const now = new Date().toISOString();
  const rows = snapshots.map(s => ({ ...s, collected_at: now }));

  // Supabase batch insert (1000개씩 분할)
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('live_snapshots').insert(batch);
    if (error) {
      console.error(`❌ live_snapshots 삽입 오류 (batch ${i}):`, error.message);
      throw error;
    }
  }
  console.log(`✅ live_snapshots ${rows.length}건 삽입 완료`);
}

/**
 * 카테고리 스냅샷 일괄 삽입
 */
export async function insertCategorySnapshots(snapshots: CategorySnapshot[]) {
  if (snapshots.length === 0) return;

  const now = new Date().toISOString();
  const rows = snapshots.map(s => ({ ...s, collected_at: now }));

  const { error } = await supabase.from('category_snapshots').insert(rows);
  if (error) {
    console.error('❌ category_snapshots 삽입 오류:', error.message);
    throw error;
  }
  console.log(`✅ category_snapshots ${rows.length}건 삽입 완료`);
}

/**
 * 스트리머 정보 upsert (있으면 업데이트, 없으면 삽입)
 */
export async function upsertStreamers(
  streamers: Array<{
    platform: 'chzzk' | 'soop';
    platform_id: string;
    channel_name: string;
    channel_image_url?: string;
  }>
) {
  if (streamers.length === 0) return;

  const rows = streamers.map(s => ({
    ...s,
    updated_at: new Date().toISOString(),
  }));

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('streamers')
      .upsert(batch, { onConflict: 'platform,platform_id' });
    if (error) {
      console.error(`❌ streamers upsert 오류 (batch ${i}):`, error.message);
    }
  }
  console.log(`✅ streamers ${rows.length}명 upsert 완료`);
}

/**
 * 수집 로그 기록
 */
export async function insertCollectionLog(log: {
  platform: string;
  total_lives: number;
  total_viewers: number;
  total_categories: number;
  duration_ms: number;
  status: 'success' | 'error';
  error_message?: string;
}) {
  const { error } = await supabase.from('collection_logs').insert({
    ...log,
    collected_at: new Date().toISOString(),
  });
  if (error) {
    console.error('❌ collection_logs 삽입 오류:', error.message);
  }
}
