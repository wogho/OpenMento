import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const heartbeatSource = readFileSync(
  path.join(ROOT, 'server/src/services/heartbeat.ts'),
  'utf-8',
);
const adminRouteSource = readFileSync(
  path.join(ROOT, 'server/src/routes/admin.ts'),
  'utf-8',
);
const llmInterfaceSource = readFileSync(
  path.join(ROOT, 'server/src/adapters/llm.interface.ts'),
  'utf-8',
);

describe('Agent Integration 회귀 방지', () => {
  it('http_webhook 202 응답을 callback 대기 상태로 취급해야 한다', () => {
    expect(heartbeatSource).toContain('pendingCallback: response.status === 202');
    expect(heartbeatSource).toContain('if (result.success && result.pendingCallback)');
    expect(heartbeatSource).toContain("waitingForCallback: true");
  });

  it('callback 대기 상태에서도 executionLockedAt 을 해제해야 한다', () => {
    expect(heartbeatSource).toContain("status: 'running'");
    expect(heartbeatSource).toContain('executionLockedAt: null');
  });

  it('callback 라우트는 비용 및 메타데이터 필드를 수용해야 한다', () => {
    expect(adminRouteSource).toContain('costUsd: z.number().nonnegative().optional()');
    expect(adminRouteSource).toContain('model: z.string().min(1).optional()');
    expect(adminRouteSource).toContain('provider: z.string().min(1).optional()');
    expect(adminRouteSource).toContain('inputTokens: z.number().int().nonnegative().optional()');
    expect(adminRouteSource).toContain('outputTokens: z.number().int().nonnegative().optional()');
    expect(adminRouteSource).toContain('cachedInputTokens: z.number().int().nonnegative().optional()');
    expect(adminRouteSource).toContain('errorCode: z.string().min(1).optional()');
  });

  it('callback 비용 메타데이터는 cost_events 예산 계층으로도 반영되어야 한다', () => {
    expect(heartbeatSource).toContain('await recordCostEvent({');
    expect(heartbeatSource).toContain("'[heartbeat] callback 비용 메타데이터가 불완전하여 cost_events 기록을 건너뜀'");
    expect(heartbeatSource).toContain('...(typeof payload.costUsd === \'number\' ? { costUsd: payload.costUsd } : {}),');
  });

  // ── Session Codec 회귀 방지 ───────────────────────────────────────────────
  it('AdapterSessionCodec 인터페이스가 llm.interface.ts에 정의되어야 한다', () => {
    expect(llmInterfaceSource).toContain('export interface AdapterSessionCodec');
    expect(llmInterfaceSource).toContain('serialize(params');
    expect(llmInterfaceSource).toContain('deserialize(raw');
    expect(llmInterfaceSource).toContain('getDisplayId(params');
    expect(llmInterfaceSource).toContain('export interface AdapterSessionResult');
    expect(llmInterfaceSource).toContain('clearSession?: boolean');
  });

  it('heartbeat.ts에 defaultSessionCodec과 resolveNextSessionState가 구현되어야 한다', () => {
    expect(heartbeatSource).toContain('const defaultSessionCodec: AdapterSessionCodec = {');
    expect(heartbeatSource).toContain('function resolveNextSessionState(');
    expect(heartbeatSource).toContain('if (result.clearSession)');
    expect(heartbeatSource).toContain('return { sessionParams: null, displayId: null }');
  });

  it('webhook payload에 이전 sessionParams가 포함되어야 한다', () => {
    expect(heartbeatSource).toContain('sessionParams: sessionParams ?? null,');
    expect(heartbeatSource).toContain('const previousSessionParams =');
    expect(heartbeatSource).toContain('sessionIdBefore: previousSessionDisplayId,');
  });

  it('실행 성공 시 세션 상태를 에이전트 레코드에 저장해야 한다', () => {
    expect(heartbeatSource).toContain('lastSessionParamsJson: nextSessionParams ?? null,');
    expect(heartbeatSource).toContain('lastSessionDisplayId: nextSessionDisplayId ?? null,');
    expect(heartbeatSource).toContain('sessionIdAfter: nextSessionDisplayId,');
  });

  it('callback에서도 세션 상태를 저장하고 sessionIdAfter를 기록해야 한다', () => {
    expect(heartbeatSource).toContain('sessionIdAfter: success ? (nextSessionDisplayId ?? null) : null,');
    expect(heartbeatSource).toContain('errorCode: payload.errorCode ?? null,');
  });

  it('callback 스키마에 세션 필드가 포함되어야 한다', () => {
    expect(adminRouteSource).toContain('sessionParams: z.record(z.unknown()).nullable().optional()');
    expect(adminRouteSource).toContain('sessionId: z.string().nullable().optional()');
    expect(adminRouteSource).toContain('clearSession: z.boolean().optional()');
  });

  it('에이전트 세션 조회/초기화 Admin API 엔드포인트가 존재해야 한다', () => {
    expect(adminRouteSource).toContain("router.get('/agents/:agentId/session'");
    expect(adminRouteSource).toContain("router.delete('/agents/:agentId/session'");
    expect(adminRouteSource).toContain('getAgentSession(');
    expect(adminRouteSource).toContain('clearAgentSession(');
  });
});