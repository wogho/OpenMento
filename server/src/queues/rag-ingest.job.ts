/**
 * rag-ingest.job.ts — RAG 임베딩 BullMQ Job 데이터 타입 정의
 *
 * plan.md Phase 5-A: BullMQ Queue 기반 임베딩 작업 큐
 *
 * API 서버(POST /admin/documents)가 파일 경로와 메타데이터를 포함한 Job을 큐에 추가하고,
 * rag-worker 프로세스가 해당 Job을 소비하여 파싱 → 임베딩 → DB 저장을 수행합니다.
 */

export interface RagIngestJobData {
  /** 기관 ID (멀티 테넌트 격리) */
  institutionId: string;
  /** 과목 ID (선택) */
  courseId?: string;
  /** 원본 파일명 (확장자 판별 및 DB 저장용) */
  fileName: string;
  /**
   * 공유 볼륨상의 물리 파일 경로
   * - Docker: UPLOAD_TMP_DIR 환경변수로 지정된 공유 볼륨 경로
   * - 로컬 개발: os.tmpdir()
   * rag-worker 컨테이너에서도 동일 경로로 접근 가능해야 합니다.
   */
  filePath: string;
  /** 추적용 고유 Delivery ID (UUID) */
  deliveryId: string;
}
