/**
 * Chzzk(치지직) 데이터 수집기
 * 
 * 사용 API 엔드포인트 (비공식, kimcore/chzzk 라이브러리 참고):
 * - GET /service/v1/search/lives?keyword=&size=50&offset=0
 *   → 라이브 방송 검색 (빈 keyword = 전체)
 * - GET /service/v2/channels/{channelId}/live-detail
 *   → 개별 채널 라이브 상세
 * - GET /service/v1/browse/lives?size=50&offset=0
 *   → 인기 라이브 목록 (소프트콘이 쓰는 방식과 유사)
 * 
 * 소프트콘 참고: 6분마다 전체 방송 수집, 429 에러 핸들링
 * StreamPulse: 30분마다 수집, 요청량 최소화
 */

import type { LiveSnapshot, CategorySnapshot } from './supabase-client.js';

const CHZZK_API_BASE = 'https://api.chzzk.naver.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// 요청 간 딜레이 (429 방지, 소프트콘도 이 문제를 겪음)
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chzzk API 요청 래퍼 (재시도 + 429 핸들링)
 */
async function chzzkFetch<T>(path: string, retries = 3): Promise<T | null> {
  const url = `${CHZZK_API_BASE}${path}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      
      if (res.status === 429) {
        // 소프트콘 개발자가 언급한 429 에러 - 백오프 후 재시도
        const waitTime = attempt * 5000;
        console.warn(`⚠️ Chzzk 429 (Too Many Requests) - ${waitTime}ms 대기 후 재시도 (${attempt}/${retries})`);
        await delay(waitTime);
        continue;
      }
      
      if (!res.ok) {
        console.error(`❌ Chzzk API ${res.status}: ${path}`);
        return null;
      }
      
      const json = await res.json() as { code: number; content: T };
      if (json.code !== 200) {
        console.error(`❌ Chzzk API code ${json.code}: ${path}`);
        return null;
      }
      
      return json.content;
    } catch (err) {
      console.error(`❌ Chzzk fetch 실패 (attempt ${attempt}):`, err);
      if (attempt < retries) await delay(2000);
    }
  }
  
  return null;
}

// ============================================
// 타입 정의 (API 응답 구조)
// ============================================

interface ChzzkLiveItem {
  liveId: number;
  liveTitle: string;
  status: string;
  concurrentUserCount: number;
  accumulateCount: number;
  openDate: string;
  liveCategory: string;
  liveCategoryValue: string;
  categoryType: string;
  channelId: string;
  channel?: {
    channelId: string;
    channelName: string;
    channelImageUrl: string;
  };
}

interface ChzzkSearchResult {
  size: number;
  page?: { next?: { offset: number } };
  data: Array<{
    live: ChzzkLiveItem;
    channel: {
      channelId: string;
      channelName: string;
      channelImageUrl: string;
    };
  }>;
}

interface ChzzkBrowseResult {
  size: number;
  page?: { next?: { offset: number } };
  data: Array<{
    liveId: number;
    liveTitle: string;
    concurrentUserCount: number;
    accumulateCount: number;
    openDate: string;
    liveCategory: string;
    liveCategoryValue: string;
    categoryType: string;
    channel: {
      channelId: string;
      channelName: string;
      channelImageUrl: string;
    };
  }>;
}

// ============================================
// 수집 로직
// ============================================

/**
 * 인기 라이브 목록 페이징 수집
 * /service/v1/browse/lives 사용 - 현재 방송 중인 전체 목록
 */
async function fetchAllLives(): Promise<ChzzkBrowseResult['data']> {
  const allLives: ChzzkBrowseResult['data'] = [];
  let offset = 0;
  const PAGE_SIZE = 50; // API 최대값
  const MAX_PAGES = 100; // 안전 장치 (최대 5000개)

  for (let page = 0; page < MAX_PAGES; page++) {
    console.log(`  📡 Chzzk 라이브 목록 수집 중... offset=${offset}`);
    
    const result = await chzzkFetch<ChzzkBrowseResult>(
      `/service/v1/browse/lives?size=${PAGE_SIZE}&offset=${offset}`
    );

    if (!result || !result.data || result.data.length === 0) {
      break;
    }

    allLives.push(...result.data);
    
    // 다음 페이지 존재 확인
    if (!result.page?.next?.offset || result.data.length < PAGE_SIZE) {
      break;
    }
    
    offset = result.page.next.offset;
    await delay(500); // 요청 간 0.5초 간격 (안전하게)
  }

  return allLives;
}

/**
 * 검색 API로 라이브 수집 (browse가 안 될 경우 폴백)
 */
async function fetchLivesViaSearch(): Promise<ChzzkSearchResult['data']> {
  const allLives: ChzzkSearchResult['data'] = [];
  let offset = 0;
  const PAGE_SIZE = 50;
  const MAX_PAGES = 60; // 최대 3000개

  for (let page = 0; page < MAX_PAGES; page++) {
    console.log(`  🔍 Chzzk 검색 API 수집 중... offset=${offset}`);
    
    const result = await chzzkFetch<ChzzkSearchResult>(
      `/service/v1/search/lives?keyword=&size=${PAGE_SIZE}&offset=${offset}`
    );

    if (!result || !result.data || result.data.length === 0) {
      break;
    }

    allLives.push(...result.data);

    if (!result.page?.next?.offset || result.data.length < PAGE_SIZE) {
      break;
    }

    offset = result.page.next.offset;
    await delay(500);
  }

  return allLives;
}

/**
 * 메인 수집 함수
 */
export async function collectChzzk(): Promise<{
  lives: LiveSnapshot[];
  categories: CategorySnapshot[];
  streamerInfos: Array<{
    platform: 'chzzk';
    platform_id: string;
    channel_name: string;
    channel_image_url?: string;
  }>;
}> {
  console.log('\n🟢 Chzzk 수집 시작');

  // 1. 라이브 목록 수집 (browse API 우선, 실패 시 search API 폴백)
  let rawLives = await fetchAllLives();
  
  if (rawLives.length === 0) {
    console.log('  ⚠️ browse API 실패, search API로 폴백');
    const searchResult = await fetchLivesViaSearch();
    rawLives = searchResult.map(item => ({
      liveId: item.live.liveId,
      liveTitle: item.live.liveTitle,
      concurrentUserCount: item.live.concurrentUserCount,
      accumulateCount: item.live.accumulateCount,
      openDate: item.live.openDate,
      liveCategory: item.live.liveCategory,
      liveCategoryValue: item.live.liveCategoryValue,
      categoryType: item.live.categoryType,
      channel: item.channel,
    }));
  }

  console.log(`  📊 총 ${rawLives.length}개 라이브 방송 수집됨`);

  // 2. 중복 제거 (channelId 기준)
  const uniqueMap = new Map<string, (typeof rawLives)[0]>();
  for (const live of rawLives) {
    const channelId = live.channel?.channelId;
    if (channelId && !uniqueMap.has(channelId)) {
      uniqueMap.set(channelId, live);
    }
  }
  const uniqueLives = Array.from(uniqueMap.values());
  console.log(`  🔄 중복 제거 후: ${uniqueLives.length}개`);

  // 3. LiveSnapshot 변환
  const lives: LiveSnapshot[] = uniqueLives.map(live => ({
    platform: 'chzzk' as const,
    platform_id: live.channel?.channelId ?? '',
    channel_name: live.channel?.channelName ?? 'Unknown',
    live_title: live.liveTitle,
    category_id: live.liveCategory,
    category_name: live.liveCategoryValue || live.liveCategory || 'Unknown',
    viewer_count: live.concurrentUserCount ?? 0,
    accumulate_count: live.accumulateCount ?? 0,
    is_live: true,
    open_date: live.openDate ?? null,
    extra_data: {
      liveId: live.liveId,
      categoryType: live.categoryType,
    },
  }));

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
        platform: 'chzzk',
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
  const streamerInfos = uniqueLives
    .filter(l => l.channel?.channelId)
    .map(live => ({
      platform: 'chzzk' as const,
      platform_id: live.channel!.channelId,
      channel_name: live.channel!.channelName ?? 'Unknown',
      channel_image_url: live.channel?.channelImageUrl,
    }));

  const totalViewers = lives.reduce((sum, l) => sum + l.viewer_count, 0);
  console.log(`  📊 Chzzk 결과: ${lives.length}개 라이브, ${categories.length}개 카테고리, 총 시청자 ${totalViewers.toLocaleString()}`);

  return { lives, categories, streamerInfos };
}
