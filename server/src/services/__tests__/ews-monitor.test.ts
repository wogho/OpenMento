/**
 * ews-monitor.ts 순수 함수 단위 테스트
 *
 * 테스트 대상:
 *  - scoreAttendance  (결석일수 → 출결 점수)
 *  - scoreAssignment  (미제출 과제 수 → 과제 점수)
 *  - scoreCounseling  (부정 상담 건수 → 상담 점수)
 *  - classifyRiskLevel(점수 → 위험도 레벨)
 *  - kstMidnightDaysAgo (N일 전 KST 자정 boundary)
 */

import { describe, it, expect } from 'vitest';
import {
  scoreAttendance,
  scoreAssignment,
  scoreCounseling,
  classifyRiskLevel,
  kstMidnightDaysAgo,
} from '../ews-monitor.js';

// ── scoreAttendance ────────────────────────────────────────────────────────────

describe('scoreAttendance', () => {
  it('LMS 미연동 (hasData=false) → 0점 (가중치 AI 상호작용으로 재배분)', () => {
    // 신규 설계: LMS 미연동 시 출석 점수 0; AI 상호작용 가중치가 60점으로 증가
    expect(scoreAttendance(0, false)).toBe(0);
    expect(scoreAttendance(5, false)).toBe(0);
  });

  it('데이터 있고 결석 0일 → 0점', () => {
    expect(scoreAttendance(0, true)).toBe(0);
  });

  it('결석 1일 → 10점 (WEIGHT_ATTENDANCE*0.5 = 20*0.5)', () => {
    expect(scoreAttendance(1, true)).toBe(10);
  });

  it('결석 2일 이상 → 20점 (WEIGHT_ATTENDANCE 만점)', () => {
    expect(scoreAttendance(2, true)).toBe(20);
    expect(scoreAttendance(10, true)).toBe(20);
  });
});

// ── scoreAssignment ────────────────────────────────────────────────────────────

describe('scoreAssignment', () => {
  it('미제출 0개 → 0점', () => {
    expect(scoreAssignment(0)).toBe(0);
  });

  it('미제출 1개 → 13점 (Math.round(25*0.5))', () => {
    expect(scoreAssignment(1)).toBe(13);
  });

  it('미제출 2개 이상 → 25점 (WEIGHT_ASSIGNMENT 만점)', () => {
    expect(scoreAssignment(2)).toBe(25);
    expect(scoreAssignment(99)).toBe(25);
  });
});

// ── scoreCounseling ────────────────────────────────────────────────────────────

describe('scoreCounseling', () => {
  it('부정 상담 0건 → 0점', () => {
    expect(scoreCounseling(0)).toBe(0);
  });

  it('부정 상담 1건 → 8점 (Math.round(15*0.5))', () => {
    expect(scoreCounseling(1)).toBe(8);
  });

  it('부정 상담 2건 이상 → 15점 (만점)', () => {
    expect(scoreCounseling(2)).toBe(15);
    expect(scoreCounseling(10)).toBe(15);
  });
});

// ── classifyRiskLevel ─────────────────────────────────────────────────────────

describe('classifyRiskLevel', () => {
  it('0점 → normal', () => expect(classifyRiskLevel(0)).toBe('normal'));
  it('59점 → normal', () => expect(classifyRiskLevel(59)).toBe('normal'));
  it('60점 → warning', () => expect(classifyRiskLevel(60)).toBe('warning'));
  it('74점 → warning', () => expect(classifyRiskLevel(74)).toBe('warning'));
  it('75점 → high_risk', () => expect(classifyRiskLevel(75)).toBe('high_risk'));
  it('89점 → high_risk', () => expect(classifyRiskLevel(89)).toBe('high_risk'));
  it('90점 → critical', () => expect(classifyRiskLevel(90)).toBe('critical'));
  it('100점 → critical', () => expect(classifyRiskLevel(100)).toBe('critical'));
});

// ── kstMidnightDaysAgo ────────────────────────────────────────────────────────

describe('kstMidnightDaysAgo', () => {
  it('0일 전 → 오늘 KST 자정(UTC 전날 15:00)', () => {
    const result = kstMidnightDaysAgo(0);
    // KST 자정 = UTC -9h → getUTCHours() === 15
    expect(result.getUTCHours()).toBe(15);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it('1일 전 → 어제 KST 자정', () => {
    const today = kstMidnightDaysAgo(0);
    const yesterday = kstMidnightDaysAgo(1);
    // 정확히 24시간 차이
    expect(today.getTime() - yesterday.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('7일 전 → 168시간 전', () => {
    const today = kstMidnightDaysAgo(0);
    const weekAgo = kstMidnightDaysAgo(7);
    expect(today.getTime() - weekAgo.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('반환 타입은 Date 인스턴스', () => {
    expect(kstMidnightDaysAgo(3)).toBeInstanceOf(Date);
  });
});
