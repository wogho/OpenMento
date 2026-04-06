/**
 * webhook.job.ts — BullMQ Webhook Job 데이터 타입 정의
 *
 * Queue와 Worker 양쪽이 동일한 타입을 임포트하도록 별도 파일로 분리.
 */

export interface WebhookJobData {
  /** GitHub 이벤트 타입 */
  eventType: 'push' | 'pull_request';
  /** payload.repository.full_name */
  repoFullName: string;
  /** 직렬화된 GitHub Webhook Payload (JSON 문자열) */
  payloadJson: string;
  /** X-GitHub-Delivery 헤더 (idempotency key) */
  deliveryId: string;
}
