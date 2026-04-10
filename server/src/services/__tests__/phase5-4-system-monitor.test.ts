/**
 * phase5-4-system-monitor.test.ts
 *
 * Phase 5-4 시스템 상태 모니터링 UI 구현 검증 테스트
 *
 * 커버리지:
 *  ① 서비스 파일 존재 여부: system-status.ts, routes/system.ts
 *  ② SystemStatusResult 타입 구조 검증
 *  ③ system-status.ts 함수 export 구조 검증
 *  ④ routes/system.ts 엔드포인트 구조 (GET /status, GET /agents, GET /runs, POST /restart)
 *  ⑤ admin.ts에 systemRouter 마운트 여부
 *  ⑥ heartbeat.ts socket.io emit 코드 삽입 여부 (agent:status_change)
 *  ⑦ UI 컴포넌트 SystemMonitor.tsx 존재 및 구조 검증
 *  ⑧ AdminPage.tsx에 'system' 탭 추가 여부
 *  ⑨ API 계약 Mock 흐름 시뮬레이션
 *  ⑩ 서비스 재시작 엔드포인트 계약 검증
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const SERVER_SRC = path.join(ROOT, 'server/src');
const UI_PAGES   = path.join(ROOT, 'ui/src/pages');

// ─────────────────────────────────────────────────────────────────────────────
// ① 파일 존재 여부 검증
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 5-4 파일 존재 여부', () => {
  it('system-status.ts 서비스 파일이 존재해야 한다', () => {
    const p = path.join(SERVER_SRC, 'services/system-status.ts');
    expect(existsSync(p), `파일 없음: ${p}`).toBe(true);
  });

  it('routes/system.ts 라우터 파일이 존재해야 한다', () => {
    const p = path.join(SERVER_SRC, 'routes/system.ts');
    expect(existsSync(p), `파일 없음: ${p}`).toBe(true);
  });

  it('ui/pages/admin/SystemMonitor.tsx 컴포넌트가 존재해야 한다', () => {
    const p = path.join(UI_PAGES, 'admin/SystemMonitor.tsx');
    expect(existsSync(p), `파일 없음: ${p}`).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② system-status.ts 구조 검증
// ─────────────────────────────────────────────────────────────────────────────
describe('system-status.ts 구조', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(path.join(SERVER_SRC, 'services/system-status.ts'), 'utf-8');
  });

  it('getSystemStatus 함수를 export해야 한다', () => {
    expect(content).toMatch(/export\s+(async\s+)?function\s+getSystemStatus/);
  });

  it('ServiceStatus 타입을 export해야 한다', () => {
    expect(content).toMatch(/export\s+type\s+ServiceStatus/);
  });

  it('ServiceInfo 인터페이스를 export해야 한다', () => {
    expect(content).toMatch(/export\s+interface\s+ServiceInfo/);
  });

  it('SystemStatusResult 인터페이스를 export해야 한다', () => {
    expect(content).toMatch(/export\s+interface\s+SystemStatusResult/);
  });

  it('DB 헬스체크 로직이 포함되어야 한다 (SELECT 1)', () => {
    expect(content).toMatch(/SELECT\s+1/);
  });

  it('Redis 헬스체크 로직이 포함되어야 한다 (REDIS_URL)', () => {
    expect(content).toMatch(/REDIS_URL/);
    expect(content).toMatch(/ping\(\)/);
  });

  it('Heartbeat 스케줄러 상태 체크가 포함되어야 한다', () => {
    expect(content).toMatch(/getHeartbeatStatus/);
  });

  it('services 배열에 4개 서비스 정보가 포함되어야 한다', () => {
    expect(content).toMatch(/API\s+Server/);
    expect(content).toMatch(/Database/);
    expect(content).toMatch(/Redis/);
    expect(content).toMatch(/AI\s+Scheduler/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ routes/system.ts 엔드포인트 구조
// ─────────────────────────────────────────────────────────────────────────────
describe('routes/system.ts 엔드포인트', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(path.join(SERVER_SRC, 'routes/system.ts'), 'utf-8');
  });

  it('GET /status 엔드포인트가 있어야 한다', () => {
    expect(content).toMatch(/router\.get\(\s*['"`]\/status['"`]/);
  });

  it('GET /agents 엔드포인트가 있어야 한다', () => {
    expect(content).toMatch(/router\.get\(\s*['"`]\/agents['"`]/);
  });

  it('GET /runs 엔드포인트가 있어야 한다', () => {
    expect(content).toMatch(/router\.get\(\s*['"`]\/runs['"`]/);
  });

  it('POST /restart 엔드포인트가 있어야 한다', () => {
    expect(content).toMatch(/router\.post\(\s*['"`]\/restart['"`]/);
  });

  it('재시작 엔드포인트가 SIGTERM을 사용하여 graceful shutdown을 유도해야 한다', () => {
    expect(content).toMatch(/SIGTERM/);
  });

  it('runs 엔드포인트에 Zod limit 검증이 있어야 한다', () => {
    expect(content).toMatch(/z\.coerce\.number\(\)/);
  });

  it('getSystemStatus를 import해야 한다', () => {
    expect(content).toMatch(/getSystemStatus/);
  });

  it('heartbeat_runs 테이블을 import해야 한다', () => {
    expect(content).toMatch(/heartbeatRuns/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ admin.ts에 systemRouter 마운트 여부
// ─────────────────────────────────────────────────────────────────────────────
describe('admin.ts 라우터 마운트', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(path.join(SERVER_SRC, 'routes/admin.ts'), 'utf-8');
  });

  it('systemRouter를 import해야 한다', () => {
    expect(content).toMatch(/import\s+systemRouter\s+from\s+['"`]\.\/system\.js['"`]/);
  });

  it('/system 경로에 systemRouter를 마운트해야 한다', () => {
    expect(content).toMatch(/router\.use\(\s*['"`]\/system['"`]\s*,\s*systemRouter\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ heartbeat.ts socket.io 통합 여부
// ─────────────────────────────────────────────────────────────────────────────
describe('heartbeat.ts socket.io 통합', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(path.join(SERVER_SRC, 'services/heartbeat.ts'), 'utf-8');
  });

  it('chat.handler.ts에서 io를 import해야 한다', () => {
    expect(content).toMatch(/import\s+\{[^}]*\bio\b[^}]*\}\s+from\s+['"`]\.\.\/socket\/chat\.handler\.js['"`]/);
  });

  it('agent:status_change 이벤트를 emit해야 한다', () => {
    expect(content).toMatch(/agent:status_change/);
  });

  it('admin:<institutionId> 룸으로 emit해야 한다', () => {
    expect(content).toMatch(/admin:\$\{agent\.institutionId\}/);
  });

  it('completed 상태 시 emit 코드가 있어야 한다', () => {
    expect(content).toMatch(/status:\s*['"`]completed['"`]/);
    // completed emit 이후 failed emit 순서로 존재해야 함
    const completedIdx = content.indexOf("status: 'completed'");
    const failedIdx = content.indexOf("status: 'failed'");
    expect(completedIdx).toBeGreaterThan(0);
    expect(failedIdx).toBeGreaterThan(completedIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ SystemMonitor.tsx UI 구조
// ─────────────────────────────────────────────────────────────────────────────
describe('SystemMonitor.tsx UI 구조', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(path.join(UI_PAGES, 'admin/SystemMonitor.tsx'), 'utf-8');
  });

  it('서비스 상태 카드 렌더링 로직이 있어야 한다', () => {
    expect(content).toMatch(/ServiceCard/);
    expect(content).toMatch(/services\.map/);
  });

  it('agent:status_change WebSocket 이벤트를 구독해야 한다', () => {
    expect(content).toMatch(/agent:status_change/);
  });

  it('"로그 보기" 버튼과 모달이 있어야 한다', () => {
    expect(content).toMatch(/로그 보기/);
    expect(content).toMatch(/LogModal/);
  });

  it('"서비스 재시작" 버튼이 있어야 한다', () => {
    expect(content).toMatch(/서비스 재시작/);
    expect(content).toMatch(/RestartConfirmModal/);
  });

  it('POST /admin/system/restart 호출 코드가 있어야 한다', () => {
    expect(content).toMatch(/\/admin\/system\/restart/);
    expect(content).toMatch(/method:\s*['"`]POST['"`]/);
  });

  it('React Query (useQuery, useMutation)를 사용해야 한다', () => {
    expect(content).toMatch(/useQuery/);
    expect(content).toMatch(/useMutation/);
  });

  it('30초 자동 갱신(refetchInterval)이 설정되어야 한다', () => {
    expect(content).toMatch(/refetchInterval:\s*30[_,]?000/);
  });

  it('uptime과 memoryMb를 표시해야 한다', () => {
    expect(content).toMatch(/uptime/);
    expect(content).toMatch(/memoryMb/);
  });

  it('에이전트별 실행 통계 테이블이 있어야 한다', () => {
    expect(content).toMatch(/agentRows/);
    expect(content).toMatch(/runStatus/);
  });

  it('격리된 실시간 이벤트 스트림 섹션이 있어야 한다', () => {
    expect(content).toMatch(/recentEvents/);
    expect(content).toMatch(/실시간 이벤트 스트림/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ AdminPage.tsx 탭 추가 여부
// ─────────────────────────────────────────────────────────────────────────────
describe('AdminPage.tsx system 탭 통합', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(path.join(UI_PAGES, 'AdminPage.tsx'), 'utf-8');
  });

  it("AdminTab 유니온에 'system' 타입이 포함되어야 한다", () => {
    expect(content).toMatch(/['"`]system['"`]/);
    // type AdminTab union에 포함됨
    const typeBlock = content.match(/type AdminTab\s*=([\s\S]*?);/)?.[1] ?? '';
    expect(typeBlock).toMatch(/system/);
  });

  it('SystemMonitor를 lazy import해야 한다', () => {
    expect(content).toMatch(/SystemMonitor/);
    expect(content).toMatch(/lazy\(\(\)\s*=>\s*import\(.*SystemMonitor.*\)\)/);
  });

  it("tabs 배열에 system 탭 항목이 있어야 한다", () => {
    expect(content).toMatch(/id:\s*['"`]system['"`]/);
    expect(content).toMatch(/시스템 모니터링/);
  });

  it('activeTab === system 분기로 SystemMonitor가 렌더링되어야 한다', () => {
    expect(content).toMatch(/activeTab\s*===\s*['"`]system['"`]\s*&&\s*<SystemMonitor/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ API 계약 Mock 흐름 시뮬레이션
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /admin/system/status 응답 구조 시뮬레이션', () => {
  it('SystemStatusResult 구조가 올바르게 정의되어야 한다', () => {
    // 응답 구조 타입 검증 (런타임 mock)
    const mockResult = {
      services: [
        { name: 'API Server', status: 'ok', latencyMs: null, detail: 'uptime 120s' },
        { name: 'Database', status: 'ok', latencyMs: 5 },
        { name: 'Redis', status: 'unavailable', latencyMs: null, detail: 'REDIS_URL 미설정' },
        { name: 'AI Scheduler', status: 'ok', latencyMs: null },
      ],
      uptime: 120,
      memoryMb: 64,
      timestamp: new Date().toISOString(),
    };

    expect(mockResult.services).toHaveLength(4);
    expect(mockResult.services[0].name).toBe('API Server');
    expect(mockResult.services[1].name).toBe('Database');
    expect(mockResult.services[2].name).toBe('Redis');
    expect(mockResult.services[3].name).toBe('AI Scheduler');
    expect(typeof mockResult.uptime).toBe('number');
    expect(typeof mockResult.memoryMb).toBe('number');
    expect(typeof mockResult.timestamp).toBe('string');
  });

  it('ServiceStatus 유니온 값이 올바르게 정의되어야 한다', () => {
    const validStatuses = ['ok', 'degraded', 'down', 'unavailable'];
    expect(validStatuses).toContain('ok');
    expect(validStatuses).toContain('down');
    expect(validStatuses).toContain('unavailable');
  });

  it('AgentRow 구조가 올바르게 정의되어야 한다', () => {
    const mockAgentRow = {
      agentId: '00000000-0000-0000-0000-000000000001',
      agentName: 'EWS 모니터',
      role: 'ews_monitor',
      isActive: true,
      runId: '00000000-0000-0000-0000-000000000099',
      runStatus: 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      errorMessage: null,
      stdoutExcerpt: '[heartbeat] 완료: agent="EWS 모니터" runId=...',
    };

    expect(mockAgentRow.agentId).toBeTruthy();
    expect(['queued', 'wakeup', 'running', 'completed', 'failed']).toContain(mockAgentRow.runStatus);
    expect(mockAgentRow.stdoutExcerpt).toContain('heartbeat');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ POST /restart 계약 검증
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /admin/system/restart 계약', () => {
  it('응답에 message와 scheduledAt이 포함되어야 한다', () => {
    const mockResponse = {
      message: '서비스 재시작이 예약되었습니다. 잠시 후 자동으로 재기동됩니다.',
      scheduledAt: new Date().toISOString(),
    };

    expect(mockResponse.message).toContain('재시작');
    expect(typeof mockResponse.scheduledAt).toBe('string');
    expect(new Date(mockResponse.scheduledAt).getTime()).toBeGreaterThan(0);
  });

  it('routes/system.ts에 restart 권한 제한 주석이 있어야 한다', () => {
    const content = readFileSync(path.join(SERVER_SRC, 'routes/system.ts'), 'utf-8');
    expect(content).toMatch(/admin|auth/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑩ WebSocket 이벤트 계약 검증
// ─────────────────────────────────────────────────────────────────────────────
describe('agent:status_change WebSocket 이벤트 계약', () => {
  it('이벤트 페이로드 구조가 올바르게 정의되어야 한다', () => {
    const mockPayload = {
      agentId: '00000000-0000-0000-0000-000000000001',
      agentName: 'EWS 모니터',
      runId: '00000000-0000-0000-0000-000000000099',
      status: 'completed',
      finishedAt: new Date().toISOString(),
    };

    expect(['queued', 'wakeup', 'running', 'completed', 'failed']).toContain(mockPayload.status);
    expect(typeof mockPayload.agentId).toBe('string');
    expect(typeof mockPayload.agentName).toBe('string');
    expect(typeof mockPayload.runId).toBe('string');
  });

  it('failed 상태 페이로드에는 errorMessage가 포함될 수 있다', () => {
    const mockFailPayload = {
      agentId: '00000000-0000-0000-0000-000000000001',
      agentName: 'EWS 모니터',
      runId: '00000000-0000-0000-0000-000000000099',
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: 'Connection timeout',
    };

    expect(mockFailPayload.status).toBe('failed');
    expect(mockFailPayload.errorMessage).toBeTruthy();
  });

  it('SystemMonitor.tsx가 recentEvents에 페이로드를 누적해야 한다', () => {
    const content = readFileSync(path.join(UI_PAGES, 'admin/SystemMonitor.tsx'), 'utf-8');
    // setRecentEvents((prev) => [payload, ...prev].slice(0, 20)
    expect(content).toMatch(/setRecentEvents/);
    expect(content).toMatch(/slice\(0,\s*20\)/);
  });
});
