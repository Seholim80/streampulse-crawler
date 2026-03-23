/**
 * SOOP(숲) 데이터 수집기
 * 
 * 참고: HO-Silverplate/SOOP_APIs (비공식 API 정리 문서)
 * 참고: VRECORD/soop-api (Node.js 비공식 라이브러리)
 * 
 * 사용 API 엔드포인트:
 * - POST https://live.sooplive.co.kr/afreeca/player_live_api.php
 *   → 개별 스트리머 라이브 상세 정보
 * - GET  https://live.sooplive.co.kr/api/main_broad_list_api.php
 *   → 메인 방송 목록 (전체 라이브)
 * - GET  https://live.sooplive.co.kr/api/searchAll.php
 *   → 방송 검색
 * 
 * 주의: SOOP 한국 서버(live.sooplive.co.kr)만 접근 가능
 *       글로벌(live.afreecatv.com)은 다른 엔드포인트
 */

import type { LiveSnapshot, CategorySnapshot } from './supabase-client.js';

const SOOP_BASE = 'https://live.sooplive.co.kr';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Origin': 'https://play.sooplive.co.kr',
  'Referer': 'https://play.sooplive.co.kr/',
  'Accept': 'application/json',
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// SOOP API 타입 정의
// ============================================

interface SoopBroadItem {
  user_id: string;          // 스트리머 ID (bjId)
  user_nick: string;        // 닉네임
  station_name?: string;    // 방송국 이름
  broad_no: string;         // 방송 번호
  broad_title: string;      // 방송 제목
  current_sum_viewer: string | number;  // 현재 시청자 수
  total_view_cnt?: string | number;     // 누적 시청자
  broad_cate_no?: string;   // 카테고리 코드
  broad_cate_nm?: string;   // 카테고리 이름 (없을 수 있음)
  category_name?: string;   // 카테고리 이름 (대체 필드)
  broad_start?: string;     // 방송 시작 시간
  profile_image?: string;   // 프로필 이미지
}

interface SoopBroadListResponse {
  broad: SoopBroadItem[];
  total_cnt?: number;
}

// ============================================
// API 요청 함수
// ============================================

/**
 * SOOP 메인 방송 목록 API
 * 카테고리별 전체 라이브 방송을 페이징으로 수집
 */
async function fetchBroadList(page: number = 1): Promise<SoopBroadItem[]> {
  try {
    // SOOP의 방송 목록 API - 전체 방송 리스트
    const url = `${SOOP_BASE}/api/main_broad_list_api.php`;
    const params = new URLSearchParams({
      selectType: 'action',
      selectValue: '',
      orderType: 'view_cnt',
      pageNo: String(page),
      lang: 'ko_KR',
    });

    const res = await fetch(`${url}?${params}`, { headers: HEADERS });
    
    if (!res.ok) {
      console.error(`❌ SOOP broad list ${res.status}`);
      return [];
    }

    const data = await res.json();
    
    // 응답 형태에 따라 파싱
    if (Array.isArray(data)) {
      return data as SoopBroadItem[];
    }
    if (data?.broad && Array.isArray(data.broad)) {
      return data.broad as SoopBroadItem[];
    }
    if (data?.data && Array.isArray(data.data)) {
      return data.data as SoopBroadItem[];
    }
    
    return [];
  } catch (err) {
    console.error('❌ SOOP broad list 요청 실패:', err);
    return [];
  }
}

/**
 * SOOP 카테고리별 방송 목록 수집
 * 게임, 토크, 먹방 등 주요 카테고리별 수집
 */
async function fetchCategoryBroads(categoryNo: string): Promise<SoopBroadItem[]> {
  try {
    const url = `${SOOP_BASE}/api/main_broad_list_api.php`;
    const params = new URLSearchParams({
      selectType: 'action',
      selectValue: categoryNo,
      orderType: 'view_cnt',
      pageNo: '1',
      lang: 'ko_KR',
    });

    const res = await fetch(`${url}?${params}`, { headers: HEADERS });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data?.broad) return data.broad;
    if (data?.data) return data.data;
    
    return [];
  } catch {
    return [];
  }
}

/**
 * SOOP 라이브 전체 목록 수집 (다중 페이지)
 */
async function fetchAllBroadList(): Promise<SoopBroadItem[]> {
  const allBroads: SoopBroadItem[] = [];
  const MAX_PAGES = 20; // 안전장치

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`  📡 SOOP 방송 목록 수집 중... page=${page}`);
    
    const broads = await fetchBroadList(page);
    
    if (broads.length === 0) break;
    
    allBroads.push(...broads);
    
    // 결과가 적으면 마지막 페이지
    if (broads.length < 40) break;
    
    await delay(800); // SOOP은 좀 더 보수적으로
  }

  return allBroads;
}

/**
 * player_live_api.php를 통한 개별 스트리머 라이브 정보 조회
 * (대량 수집에는 비효율적이므로 보조용)
 */
async function fetchLiveDetail(streamerId: string): Promise<SoopBroadItem | null> {
  try {
    const url = `${SOOP_BASE}/afreeca/player_live_api.php`;
    
    const body = new URLSearchParams({
      bid: streamerId,
      type: 'live',
      from_api: '0',
      mode: 'landing',
      player_type: 'html5',
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) return null;

    const data = await res.json();
    
    // RESULT: 1 = 방송 중, 0 = 방송 종료
    if (data?.CHANNEL?.RESULT !== 1) return null;

    const ch = data.CHANNEL;
    return {
      user_id: streamerId,
      user_nick: ch.BJNICK || streamerId,
      broad_no: String(ch.BNO || ''),
      broad_title: ch.TITLE || '',
      current_sum_viewer: ch.CTUSER || 0,
      broad_cate_no: ch.CATE || '',
      broad_start: '',
    };
  } catch {
    return null;
  }
}

// ============================================
// 카테고리 코드 매핑 (SOOP 주요 카테고리)
// ============================================

const SOOP_CATEGORY_MAP: Record<string, string> = {
  '00040000': '게임',
  '00040001': '리그 오브 레전드',
  '00040131': 'VRChat',
  '00040018': '마인크래프트',
  '00040021': '배틀그라운드',
  '00040068': '오버워치',
  '00040098': '발로란트',
  '00040029': '피파 온라인',
  '00040033': '메이플스토리',
  '00040128': '로스트아크',
  '00040136': '이터널 리턴',
  '00040035': '스타크래프트',
  '00130000': '토크/캠방',
  '00150000': '먹방/쿡방',
  '00160000': '스포츠',
  '00180000': '뮤직',
  '00190000': '여행/야외',
};

function getCategoryName(cateNo: string, rawName?: string): string {
  if (rawName) return rawName;
  return SOOP_CATEGORY_MAP[cateNo] || cateNo || 'Unknown';
}

// ============================================
// 메인 수집 함수
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

  // 1. 전체 방송 목록 수집
  const rawBroads = await fetchAllBroadList();
  console.log(`  📊 총 ${rawBroads.length}개 방송 수집됨`);

  if (rawBroads.length === 0) {
    console.warn('  ⚠️ SOOP 수집 결과 없음 (API 변경 가능성)');
    return { lives: [], categories: [], streamerInfos: [] };
  }

  // 2. 중복 제거 (user_id 기준)
  const uniqueMap = new Map<string, SoopBroadItem>();
  for (const broad of rawBroads) {
    if (broad.user_id && !uniqueMap.has(broad.user_id)) {
      uniqueMap.set(broad.user_id, broad);
    }
  }
  const uniqueBroads = Array.from(uniqueMap.values());
  console.log(`  🔄 중복 제거 후: ${uniqueBroads.length}개`);

  // 3. LiveSnapshot 변환
  const lives: LiveSnapshot[] = uniqueBroads.map(broad => {
    const viewerCount = typeof broad.current_sum_viewer === 'string'
      ? parseInt(broad.current_sum_viewer, 10) || 0
      : broad.current_sum_viewer || 0;

    const categoryName = getCategoryName(
      broad.broad_cate_no || '',
      broad.broad_cate_nm || broad.category_name
    );

    return {
      platform: 'soop' as const,
      platform_id: broad.user_id,
      channel_name: broad.user_nick || broad.user_id,
      live_title: broad.broad_title,
      category_id: broad.broad_cate_no || null,
      category_name: categoryName,
      viewer_count: viewerCount,
      accumulate_count: typeof broad.total_view_cnt === 'string'
        ? parseInt(broad.total_view_cnt, 10) || 0
        : (broad.total_view_cnt as number) || 0,
      is_live: true,
      open_date: broad.broad_start || null,
      extra_data: {
        broadNo: broad.broad_no,
      },
    };
  });

  // 4. 카테고리 집계
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
        category_id: live.category_id,
        category_name: catKey,
        live_count: 1,
        total_viewers: live.viewer_count,
        top_streamer_name: live.channel_name,
        top_streamer_viewers: live.viewer_count,
      });
    }
  }
  const categories = Array.from(categoryMap.values());

  // 5. 스트리머 정보 추출
  const streamerInfos = uniqueBroads.map(broad => ({
    platform: 'soop' as const,
    platform_id: broad.user_id,
    channel_name: broad.user_nick || broad.user_id,
    channel_image_url: broad.profile_image,
  }));

  const totalViewers = lives.reduce((sum, l) => sum + l.viewer_count, 0);
  console.log(`  📊 SOOP 결과: ${lives.length}개 라이브, ${categories.length}개 카테고리, 총 시청자 ${totalViewers.toLocaleString()}`);

  return { lives, categories, streamerInfos };
}
