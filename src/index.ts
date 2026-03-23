/**
 * StreamPulse 크롤러 - 메인 진입점
 * 
 * 실행 방법:
 *   npm run collect              # 전체 수집 (Chzzk + SOOP)
 *   npm run collect:chzzk        # Chzzk만
 *   npm run collect:soop         # SOOP만
 *   npm run test                 # DB 저장 없이 테스트
 * 
 * 환경변수:
 *   SUPABASE_URL          - Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY   - Supabase service_role 시크릿 키
 */

import { collectChzzk } from './chzzk-collector.js';
import { collectSoop } from './soop-collector.js';
import {
  insertLiveSnapshots,
  insertCategorySnapshots,
  upsertStreamers,
  insertCollectionLog,
} from './supabase-client.js';

// CLI 인자 파싱
const args = process.argv.slice(2);
const platformArg = args.find(a => a === '--platform')
  ? args[args.indexOf('--platform') + 1]
  : null;
const isDryRun = args.includes('--dry-run');

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     StreamPulse Crawler v1.0           ║');
  console.log('║     Chzzk + SOOP 데이터 수집기         ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`⏰ 실행 시각: ${new Date().toISOString()}`);
  console.log(`🎯 모드: ${isDryRun ? 'DRY RUN (DB 저장 안 함)' : 'PRODUCTION'}`);
  console.log(`📡 플랫폼: ${platformArg || '전체 (chzzk + soop)'}`);

  const startTime = Date.now();
  const errors: string[] = [];

  // ============================================
  // Chzzk 수집
  // ============================================
  if (!platformArg || platformArg === 'chzzk') {
    const chzzkStart = Date.now();
    try {
      const { lives, categories, streamerInfos } = await collectChzzk();

      if (isDryRun) {
        console.log('\n[DRY RUN] Chzzk 수집 완료 - DB 저장 생략');
        console.log(`  라이브: ${lives.length}개`);
        console.log(`  카테고리: ${categories.length}개`);
        console.log(`  상위 10개 방송:`);
        lives
          .sort((a, b) => b.viewer_count - a.viewer_count)
          .slice(0, 10)
          .forEach((l, i) => {
            console.log(`    ${i + 1}. ${l.channel_name} - ${l.category_name} (${l.viewer_count.toLocaleString()}명)`);
          });
      } else {
        // DB 저장
        await insertLiveSnapshots(lives);
        await insertCategorySnapshots(categories);
        await upsertStreamers(streamerInfos);

        const totalViewers = lives.reduce((sum, l) => sum + l.viewer_count, 0);
        await insertCollectionLog({
          platform: 'chzzk',
          total_lives: lives.length,
          total_viewers: totalViewers,
          total_categories: categories.length,
          duration_ms: Date.now() - chzzkStart,
          status: 'success',
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ Chzzk 수집 실패:', errorMsg);
      errors.push(`chzzk: ${errorMsg}`);

      if (!isDryRun) {
        await insertCollectionLog({
          platform: 'chzzk',
          total_lives: 0,
          total_viewers: 0,
          total_categories: 0,
          duration_ms: Date.now() - chzzkStart,
          status: 'error',
          error_message: errorMsg,
        });
      }
    }
  }

  // ============================================
  // SOOP 수집
  // ============================================
  if (!platformArg || platformArg === 'soop') {
    const soopStart = Date.now();
    try {
      const { lives, categories, streamerInfos } = await collectSoop();

      if (isDryRun) {
        console.log('\n[DRY RUN] SOOP 수집 완료 - DB 저장 생략');
        console.log(`  라이브: ${lives.length}개`);
        console.log(`  카테고리: ${categories.length}개`);
        console.log(`  상위 10개 방송:`);
        lives
          .sort((a, b) => b.viewer_count - a.viewer_count)
          .slice(0, 10)
          .forEach((l, i) => {
            console.log(`    ${i + 1}. ${l.channel_name} - ${l.category_name} (${l.viewer_count.toLocaleString()}명)`);
          });
      } else {
        await insertLiveSnapshots(lives);
        await insertCategorySnapshots(categories);
        await upsertStreamers(streamerInfos);

        const totalViewers = lives.reduce((sum, l) => sum + l.viewer_count, 0);
        await insertCollectionLog({
          platform: 'soop',
          total_lives: lives.length,
          total_viewers: totalViewers,
          total_categories: categories.length,
          duration_ms: Date.now() - soopStart,
          status: 'success',
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ SOOP 수집 실패:', errorMsg);
      errors.push(`soop: ${errorMsg}`);

      if (!isDryRun) {
        await insertCollectionLog({
          platform: 'soop',
          total_lives: 0,
          total_viewers: 0,
          total_categories: 0,
          duration_ms: Date.now() - soopStart,
          status: 'error',
          error_message: errorMsg,
        });
      }
    }
  }

  // ============================================
  // 결과 요약
  // ============================================
  const totalDuration = Date.now() - startTime;
  console.log('\n════════════════════════════════════════');
  console.log(`✅ 수집 완료 (${(totalDuration / 1000).toFixed(1)}초)`);
  
  if (errors.length > 0) {
    console.log(`⚠️ 에러 ${errors.length}건:`);
    errors.forEach(e => console.log(`  - ${e}`));
    process.exit(1); // GitHub Actions에서 실패로 표시
  }
}

main().catch(err => {
  console.error('💥 치명적 오류:', err);
  process.exit(1);
});
