/**
 * logger.ts — Pino 기반 구조적 JSON 로거
 *
 * - 개발환경(NODE_ENV !== 'production'): pino-pretty로 컬러 출력
 * - 운영환경(NODE_ENV === 'production'): JSON 형태 (CloudWatch / Datadog 수집용)
 *
 * 사용법:
 *   import { logger, createContextLogger } from '../utils/logger.js';
 *   // 전역 로거
 *   logger.info({ institutionId }, 'heartbeat 스케줄러 기동');
 *   // 컨텍스트 바인딩 (traceId 자동 주입)
 *   const log = createContextLogger({ traceId, institutionId });
 *   log.warn({ runId }, 'EWS 배치 실패');
 */

import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = pino(
  {
    level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
    // UTC 대신 ms 정밀 타임스탬프 (CloudWatch 정렬 친화)
    timestamp: pino.stdTimeFunctions.isoTime,
    // 에러 객체의 스택 트레이스를 err.stack 으로 직렬화
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    base: {
      service: 'educlip-api',
      env: process.env['NODE_ENV'] ?? 'development',
    },
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
        },
      })
    : undefined, // 운영환경: stdout JSON (Docker / PM2 로그 드라이버가 수집)
);

/**
 * 요청·실행 컨텍스트(traceId, institutionId 등)를 미리 바인딩한
 * 자식 로거(child logger)를 반환합니다.
 *
 * Heartbeat runId, institutionId 등을 모든 로그 라인에 자동으로 포함시켜
 * Datadog / CloudWatch 필터링에 사용합니다.
 */
export function createContextLogger(
  context: Record<string, string | number | boolean | undefined>,
): pino.Logger {
  return logger.child(context);
}
