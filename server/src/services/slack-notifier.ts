/**
 * slack-notifier.ts — EWS 알림 에스컬레이션 Slack 발송 서비스
 *
 * plan.md Phase 2-3: Slack Webhook 알림 발송 함수 구현
 * plan.md Phase 2-4: 알림 에스컬레이션 시스템
 *
 * ── 에스컬레이션 정책 ────────────────────────────────────────────────────────
 *
 *  warning   (60~74점): 담당 강사 채널에 Slack 경고 메시지 발송
 *  high_risk (75~89점): 강사 + 원장 채널에 Slack 위험 메시지 발송
 *                       + 멘탈케어 에이전트 자동 안부 메시지 트리거
 *  critical  (90~100점): 전 단계 + 즉시 전화 상담 예약 자동 생성
 *
 * ── 보안 설계 ────────────────────────────────────────────────────────────────
 *
 *  - Slack Webhook URL은 process.env.SLACK_WEBHOOK_URL 에서 읽음
 *    (PUT /admin/secrets 로 설정 → secretsStore + process.env 동기화)
 *  - 수강생 식별 정보는 anonymousId(앞 8자리 UUID)만 포함 — 개인정보 최소화
 *
 * ── 신뢰성 설계 ─────────────────────────────────────────────────────────────
 *
 *  - 외부 API 실패 시 logger.error 후 계속 진행 (throw X)
 *  - Heartbeat 트랜잭션을 블로킹하지 않도록 호출부에서 void fire-and-forget 사용
 */

import { db, consultationBookings } from '@openmento/db';
import { sendMentalCareMessage } from './mental-care-agent.js';
import type { EwsScoreResult } from './ews-monitor.js';
import { logger } from '../utils/logger.js';

// ── 상수 ────────────────────────────────────────────────────────────────────

/** Slack Webhook 전송 타임아웃 (ms) */
const SLACK_TIMEOUT_MS = 10_000;

// ── 수준별 이모지 + 레이블 ─────────────────────────────────────────────────────

const RISK_LABEL: Record<EwsScoreResult['riskLevel'], string> = {
  normal:    '✅ 정상',
  warning:   '⚠️ 주의',
  high_risk: '🔴 위험',
  critical:  '🚨 긴급',
};

const RISK_COLOR: Record<EwsScoreResult['riskLevel'], string> = {
  normal:    '#36a64f',
  warning:   '#f2c744',
  high_risk: '#d14343',
  critical:  '#7b0000',
};

// ── Slack Block Kit 메시지 빌더 ───────────────────────────────────────────────

function buildSlackPayload(
  scores: EwsScoreResult[],
  severity: 'warning' | 'high_risk' | 'critical',
): object {
  const label  = RISK_LABEL[severity];
  const color  = RISK_COLOR[severity];
  const count  = scores.length;

  const headerText =
    severity === 'critical'
      ? `🚨 *EWS 긴급 알림* — ${count}명 즉시 상담 예약 생성`
      : severity === 'high_risk'
      ? `🔴 *EWS 위험 알림* — ${count}명 위험 수강생 감지`
      : `⚠️ *EWS 주의 알림* — ${count}명 주의 수강생 감지`;

  const rows = scores.map((s) => {
    const anonId = s.studentId.slice(0, 8).toUpperCase();
    const detail =
      `출결 +${s.components.attendance}  과제 +${s.components.assignment}  ` +
      `상담 +${s.components.counseling}  AI참여 +${s.components.aiInteraction}`;
    return `*${label}* | 수강생 \`…${anonId}\` | 위험점수 *${s.totalScore}점*\n> ${detail}`;
  });

  return {
    text: headerText,
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: headerText.replace(/\*/g, ''), emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: rows.join('\n\n') },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `*OpenMento EWS* | ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`,
              },
            ],
          },
        ],
      },
    ],
  };
}

// ── 단건 Slack 전송 헬퍼 ─────────────────────────────────────────────────────

async function postToSlack(webhookUrl: string, payload: object): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(본문 없음)');
      throw new Error(`Slack 응답 오류 ${response.status}: ${body}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── 상담 예약 자동 생성 ───────────────────────────────────────────────────────

async function createConsultationBookings(
  institutionId: string,
  criticalScores: EwsScoreResult[],
): Promise<void> {
  if (criticalScores.length === 0) return;

  const rows = criticalScores.map((s) => ({
    institutionId,
    studentId:           s.studentId,
    courseId:            s.courseId,
    // scoreId 가 있으면 어느 EWS 산출 시점이 이 예약을 트리거했는지 추적 가능
    triggeredByScoreId:  s.scoreId ?? null,
  }));

  await db.insert(consultationBookings).values(rows);

  logger.info(
    `[slack-notifier] 상담 예약 자동 생성: ${rows.length}건 ` +
    `(institutionId=${institutionId})`,
  );
}

// ── 공개 API ────────────────────────────────────────────────────────────────

/**
 * EWS 위험 점수 배치를 기반으로 Slack 알림 에스컬레이션을 수행합니다.
 *
 * - normal 수준은 무시합니다.
 * - warning/high_risk/critical 각각 Slack 메시지를 발송합니다.
 * - high_risk 이상이면 멘탈케어 에이전트 안부 메시지를 트리거합니다.
 * - critical이면 상담 예약을 자동 생성합니다.
 *
 * 이 함수는 절대 throw 하지 않습니다. 외부 API 실패는 logger.error 후 계속합니다.
 *
 * @param institutionId  기관 UUID
 * @param scores         EWS 전체 산출 결과 배열
 */
export async function sendEwsEscalations(
  institutionId: string,
  scores: EwsScoreResult[],
): Promise<void> {
  const webhookUrl = process.env['SLACK_WEBHOOK_URL']?.trim();

  // non-normal 분류
  const warningScores   = scores.filter((s) => s.riskLevel === 'warning');
  const highRiskScores  = scores.filter((s) => s.riskLevel === 'high_risk');
  const criticalScores  = scores.filter((s) => s.riskLevel === 'critical');

  const needsSlack  = warningScores.length + highRiskScores.length + criticalScores.length > 0;
  const needsCare   = highRiskScores.length + criticalScores.length > 0;
  const needsBooking = criticalScores.length > 0;

  if (!needsSlack && !needsCare && !needsBooking) return;

  // ── 1. Slack 발송 ──────────────────────────────────────────────────────────
  if (webhookUrl) {
    const slackTasks: Promise<void>[] = [];

    if (warningScores.length > 0) {
      slackTasks.push(
        postToSlack(webhookUrl, buildSlackPayload(warningScores, 'warning'))
          .catch((err) => logger.error({ err }, '[slack-notifier] warning 발송 실패')),
      );
    }
    if (highRiskScores.length > 0) {
      slackTasks.push(
        postToSlack(webhookUrl, buildSlackPayload(highRiskScores, 'high_risk'))
          .catch((err) => logger.error({ err }, '[slack-notifier] high_risk 발송 실패')),
      );
    }
    if (criticalScores.length > 0) {
      slackTasks.push(
        postToSlack(webhookUrl, buildSlackPayload(criticalScores, 'critical'))
          .catch((err) => logger.error({ err }, '[slack-notifier] critical 발송 실패')),
      );
    }

    await Promise.allSettled(slackTasks);
  } else if (needsSlack) {
    logger.warn(
      '[slack-notifier] SLACK_WEBHOOK_URL 미설정 — Slack 알림 건너뜀. ' +
      '(PUT /admin/secrets 로 slackWebhookUrl 설정 필요)',
    );
  }

  // ── 2. 멘탈케어 에이전트 안부 메시지 (high_risk + critical) ──────────────────
  if (needsCare) {
    const careTargets = [...highRiskScores, ...criticalScores];
    const careTasks = careTargets.map((s) =>
      sendMentalCareMessage(institutionId, s.studentId, s.courseId, s.totalScore)
        .catch((err) =>
          logger.error(
            { err, studentId: s.studentId },
            '[slack-notifier] 멘탈케어 메시지 실패',
          ),
        ),
    );
    await Promise.allSettled(careTasks);
  }

  // ── 3. 상담 예약 자동 생성 (critical) ─────────────────────────────────────
  if (needsBooking) {
    await createConsultationBookings(institutionId, criticalScores).catch((err) =>
      logger.error({ err }, '[slack-notifier] 상담 예약 생성 실패'),
    );
  }

  // ── 결과 로그 ──────────────────────────────────────────────────────────────
  logger.info(
    `[slack-notifier] 에스컬레이션 완료 — ` +
    `warning=${warningScores.length} ` +
    `high_risk=${highRiskScores.length} ` +
    `critical=${criticalScores.length} ` +
    `(institutionId=${institutionId})`,
  );
}

/**
 * Slack Webhook URL에 테스트 메시지를 발송합니다.
 * PUT /admin/ews/slack-test 에서 호출합니다.
 *
 * @param webhookUrl  테스트할 Slack Webhook URL
 * @throws 발송 실패 시 Error를 throw (caller가 에러 처리)
 */
/**
 * 시스템 레벨 알림을 Slack에 발송합니다 (서킷 브레이커 작동 등).
 *
 * - SLACK_WEBHOOK_URL 미설정 시 조용히 무시합니다.
 * - 발송 실패해도 throw 하지 않습니다.
 */
export async function sendSystemAlert(message: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await postToSlack(webhookUrl, {
      text: message,
      attachments: [
        {
          color: '#ff6600',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: message },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `*OpenMento 시스템* | ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`,
                },
              ],
            },
          ],
        },
      ],
    });
  } catch (err) {
    logger.error({ err }, '[slack-notifier] 시스템 알림 발송 실패');
  }
}

export async function sendSlackTestMessage(webhookUrl: string): Promise<void> {
  await postToSlack(webhookUrl, {
    text: '✅ OpenMento EWS — Slack 연동 테스트 메시지입니다.',
    attachments: [
      {
        color: '#36a64f',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*OpenMento EWS Slack 알림이 정상 연동되었습니다.* 🎉\n실제 위험 수강생 감지 시 이 채널로 에스컬레이션 알림이 발송됩니다.',
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `테스트 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`,
              },
            ],
          },
        ],
      },
    ],
  });
}

export async function sendSystemErrorToSlack(
  webhookUrl: string,
  error: Error,
  context?: Record<string, unknown>
): Promise<void> {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🚨 [OpenMento] System Critical Error' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Error Message:*\n\`${error.message}\``,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Stack Trace:*\n\`\`\`${error.stack?.slice(0, 1000) || 'No stack trace'}\`\`\``,
      },
    },
  ];

  if (context) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Context:* ${JSON.stringify(context)}`,
        },
      ],
    });
  }

  const payload = {
    text: 'System Critical Error',
    blocks,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to send slack alert');
    }
  } catch (err) {
    logger.error({ err }, 'Network error sending slack alert');
  }
}
