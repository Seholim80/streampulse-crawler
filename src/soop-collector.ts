/**
 * SOOP(숲) 데이터 수집기 v2
 * 
 * 수정: HO-Silverplate/SOOP_APIs 문서 기반으로 정확한 필드명 사용
 * 
 * 핵심 엔드포인트:
 *   POST https://live.sooplive.co.kr/afreeca/player_live_api.php → 개별 방송 상세
 *   GET  https://live.sooplive.co.kr/api/main_broad_list_api.php → 방송 목록 (REAL_BROAD 배열)
 * 
 * 시청자수 필드:
 *   - total_view_cnt: PC + 모바일 합산 시청자 (숫자 문자열)
 *   - pc_view_cnt: PC 시청자
 *   - m_current_view_cnt: 모바일 시청자
 */

import type { LiveSnapshot, CategorySnapshot } from './supabase-client.js';

const SOOP_BASE = 'https://live.sooplive.co.kr';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': 'https://www.sooplive.co.kr/',
  'Accept': 'application/json, text/plain, */*',
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// SOOP API 타입 (HO-Silverplate 문서 기반)
// ============================================

interface SoopRealBroad {
  user_id: string;
  station_name: string;
  broad_no: string;
  broad_title: string;
  broad_cate_name: string;    // 카테고리 이름 (직접 제공됨!)
  broad_start: string;
  total_view_cnt: string;     // PC+모바일 합산 시청자 (핵심!)
  pc_view_cnt: string;        // PC 시청자
  m_current_view_cnt: string; // 모바일 시청자
  broad_bps: string;
  broad_img: string;
  is_password: string;
  parent_broad_no: string;
  rank: string;
}

interface SoopListResponse {
  RESULT: string;
  TOTAL_CNT: string;
  HAS_MORE_LIST: boolean;
  REAL_BROAD: SoopRealBroad[];
}

// ============================================
// API 요청
// ============================================

async function fetchBroadList(page: number = 1): Promise<SoopRealBroad[]> {
  try {
    const url = `${SOOP_BASE}/api/main_broad_list_api.php`;
    const params = new URLSearchParams({
      selectType: 'action',
      selectValue: '',
      orderType: 'view_cnt',
      pageNo: String(page),
      lang: 'ko_KR',
      szType: 'json',
      type: 'cate',
      acttype: 'live',
      mode: 'landing',
    });

    const res = await fetch(`${url}?${params}`, { headers: HEADERS });
    
    if (!res.ok) {
      console.error(`  ❌ SOOP API ${res.status}`);
      return [];
    }

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('  ❌ SOOP JSON 파싱 실패');
      return [];
    }

    // API 응답 구조: { RESULT, TOTAL_CNT, REAL_BROAD: [...] }
    if (data.REAL_BROAD && Array.isArray(data.REAL_BROAD)) {
      console.log(`  📡 page ${page}: REAL_BROAD ${data.REAL_BROAD.length}개 (TOTAL_CNT: ${data.TOTAL_CNT || '?'})`);
      return data.REAL_BROAD;
    }

    // 혹시 다른 형태일 경우 폴백
    if (Array.isArray(data)) {
      console.log(`  📡 page ${page}: array ${data.length}개`);
      return data;
    }
    if (data.broad && Array.isArray(data.broad)) {
      console.log(`  📡 page ${page}: broad ${data.broad.length}개`);
      return data.broad;
    }

    console.warn(`  ⚠️ page ${page}: 알 수 없는 응답 구조`, Object.keys(data));
    return [];
  } catch (err) {
    console.error('  ❌ SOOP 요청 실패:', err);
    return [];
  }
}

async function fetchAllBroadList(): Promise<SoopRealBroad[]> {
  const allBroads: SoopRealBroad[] = [];
  const MAX_PAGES = 30;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const broads = await fetchBroadList(page);
    
    if (broads.length === 0) break;
    
    allBroads.push(...broads);
    
    // 결과가 적으면 마지막 페이지
    if (broads.length < 50) break;
    
    await delay(600);
  }

  return allBroads;
}

// ============================================
// 시청자수 파싱 헬퍼
// ============================================

function parseViewerCount(broad: SoopRealBroad): number {
  // 1순위: total_view_cnt (PC + 모바일 합산)
  if (broad.total_view_cnt) {
    const v = parseInt(String(broad.total_view_cnt), 10);
    if (!isNaN(v) && v > 0) return v;
  }
  
  // 2순위: pc_view_cnt + m_current_view_cnt 합산
  const pc = parseInt(String(broad.pc_view_cnt || '0'), 10) || 0;
  const mobile = parseInt(String(broad.m_current_view_cnt || '0'), 10) || 0;
  if (pc + mobile > 0) return pc + mobile;

  // 3순위: 다른 가능한 필드 시도
  const anyField = (broad as any).current_sum_viewer 
    || (broad as any).view_cnt 
    || (broad as any).current_view_cnt
    || (broad as any).viewer_count;
  if (anyField) {
    const v = parseInt(String(anyField), 10);
    if (!isNaN(v) && v > 0) return v;
  }

  return 0;
}

// ============================================
// 메인 수집
// ============================================

export async function collectSoop(): Promise<{
  lives: LiveSnapshot[];
  categories: CategorySnapshot[];
  streamerInfos: Array<{
    platform: 'soop';
    platform_id: string;
    channel_name: string;
    channel_image_url?: string;
  }>;
}> {
  console.log('\n🔵 SOOP 수집 시작');

  const rawBroads = await fetchAllBroadList();
  console.log(`  📊 총 ${rawBroads.length}개 방송 수집됨`);

  // 첫 번째 방송의 필드를 로깅 (디버깅용)
  if (rawBroads.length > 0) {
    const sample = rawBroads[0];
console.log(`  🔍 샘플 전체 키:`, Object.keys(sample).join(', '));
    console.log(`  🔍 샘플 데이터:`, JSON.stringify(sample).substring(0, 500));
  }

  if (rawBroads.length === 0) {
    console.warn('  ⚠️ SOOP 수집 결과 없음');
    return { lives: [], categories: [], streamerInfos: [] };
  }

  // 중복 제거 (user_id 기준)
  const uniqueMap = new Map<string, SoopRealBroad>();
  for (const broad of rawBroads) {
    if (broad.user_id && !uniqueMap.has(broad.user_id)) {
      uniqueMap.set(broad.user_id, broad);
    }
  }
  const uniqueBroads = Array.from(uniqueMap.values());
  console.log(`  🔄 중복 제거 후: ${uniqueBroads.length}개`);

  // LiveSnapshot 변환
  const lives: LiveSnapshot[] = uniqueBroads.map(broad => {
    const viewerCount = parseViewerCount(broad);

    return {
      platform: 'soop' as const,
      platform_id: broad.user_id,
      channel_name: broad.station_name || broad.user_id,
      live_title: broad.broad_title,
      category_id: null,
      category_name: broad.broad_cate_name || 'Unknown',
      viewer_count: viewerCount,
      accumulate_count: 0,
      is_live: true,
      open_date: broad.broad_start || null,
      extra_data: {
        broadNo: broad.broad_no,
        pcViewers: parseInt(String(broad.pc_view_cnt || '0'), 10) || 0,
        mobileViewers: parseInt(String(broad.m_current_view_cnt || '0'), 10) || 0,
      },
    };
  });

  // 카테고리 집계
  const categoryMap = new Map<string, CategorySnapshot>();
  for (const live of lives) {
    const catKey = live.category_name || 'Unknown';
    const existing = categoryMap.get(catKey);
    if (existing) {
      existing.live_count++;
      existing.total_viewers += live.viewer_count;
      if (live.viewer_count > existing.top_streamer_viewers) {
        existing.top_streamer_name = live.channel_name;
        existing.top_streamer_viewers = live.viewer_count;
      }
    } else {
      categoryMap.set(catKey, {
        platform: 'soop',
        category_id: null,
        category_name: catKey,
        live_count: 1,
        total_viewers: live.viewer_count,
        top_streamer_name: live.channel_name,
        top_streamer_viewers: live.viewer_count,
      });
    }
  }
  const categories = Array.from(categoryMap.values());

  // 스트리머 정보
  const streamerInfos = uniqueBroads.map(broad => ({
    platform: 'soop' as const,
    platform_id: broad.user_id,
    channel_name: broad.station_name || broad.user_id,
    channel_image_url: undefined,
  }));

  const totalViewers = lives.reduce((sum, l) => sum + l.viewer_count, 0);
  console.log(`  📊 SOOP 결과: ${lives.length}개 라이브, ${categories.length}개 카테고리, 총 시청자 ${totalViewers.toLocaleString()}`);
  
  // 시청자수 상위 5개 출력 (디버깅)
  const top5 = [...lives].sort((a, b) => b.viewer_count - a.viewer_count).slice(0, 5);
  top5.forEach((l, i) => {
    console.log(`    ${i+1}. ${l.channel_name} - ${l.category_name} (${l.viewer_count.toLocaleString()}명)`);
  });

  return { lives, categories, streamerInfos };
}