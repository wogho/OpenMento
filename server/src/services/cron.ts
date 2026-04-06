/**
 * cron.ts — 5-field 독립 cron 파서
 *
 * 외부 라이브러리 없이 Node.js 표준 모듈만 사용합니다.
 * paperclip 오픈소스(MIT) cron 파서 구조를 교육기관 도메인에 맞게 재구현하였습니다.
 *
 * 지원 형식:  분(0-59) 시(0-23) 일(1-31) 월(1-12) 요일(0-6, 일=0)
 * 예시:
 *   '* * * * *'      — 매 분
 *   '0 * * * *'      — 매 시 정각
 *   '0 7 * * *'      — 매일 오전 7시
 *   '0 9 * * 1'      — 매주 월요일 오전 9시
 *   '0,30 * * * *'   — 매 30분마다
 *   '0 7-9 * * *'    — 매일 7~9시 정각
 *   '* /15 * * * *'   — 매 15분마다
 */

export interface CronField {
  /** 파싱된 원본 필드 문자열 */
  raw: string;
  /** 해당 필드의 유효 값 집합 (이미 구체화된 정수 Set) */
  values: Set<number>;
}

export interface CronExpression {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

// ── 내부: 단일 필드 파싱 ─────────────────────────────────────────────────────

/**
 * cron 단일 필드를 파싱하여 유효 값 Set 을 반환합니다.
 * @param field  cron 필드 문자열 (예: '0', '*', '1-5', '* /15', '0,30')
 * @param min    필드 최솟값 (포함)
 * @param max    필드 최댓값 (포함)
 */
function parseField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();

  // 복합 필드: 콤마로 구분된 복수 항목 ('0,15,30,45')
  if (field.includes(',')) {
    for (const part of field.split(',')) {
      for (const v of parseField(part.trim(), min, max)) {
        result.add(v);
      }
    }
    return result;
  }

  // 스텝 필드: '* /15' 또는 '1-5/2'
  if (field.includes('/')) {
    const [rangePart, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step < 1) {
      throw new Error(`잘못된 cron 스텝 값: "${stepStr}"`);
    }
    const [rangeMin, rangeMax] =
      rangePart === '*'
        ? [min, max]
        : rangePart.includes('-')
          ? rangePart.split('-').map(Number) as [number, number]
          : [parseInt(rangePart, 10), max];

    for (let i = rangeMin; i <= rangeMax; i += step) {
      if (i >= min && i <= max) result.add(i);
    }
    return result;
  }

  // 범위 필드: '1-5'
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    for (let i = lo; i <= hi; i++) {
      if (i >= min && i <= max) result.add(i);
    }
    return result;
  }

  // 와일드카드: '*'
  if (field === '*') {
    for (let i = min; i <= max; i++) result.add(i);
    return result;
  }

  // 단일 정수
  const num = parseInt(field, 10);
  if (isNaN(num) || num < min || num > max) {
    throw new Error(`cron 값 범위 초과: "${field}" (유효 범위: ${min}-${max})`);
  }
  result.add(num);
  return result;
}

// ── 공개 API ────────────────────────────────────────────────────────────────

/**
 * 5-field cron 문자열을 파싱한 CronExpression 을 반환합니다.
 *
 * @throws Error — 필드 개수가 5개가 아니거나 잘못된 값 포함 시
 */
export function parseCron(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `cron 표현식은 정확히 5개 필드가 필요합니다: "${expression}" (전달된 필드 수: ${fields.length})`,
    );
  }

  const [minuteStr, hourStr, domStr, monthStr, dowStr] = fields;

  return {
    minute:     { raw: minuteStr,  values: parseField(minuteStr,  0, 59) },
    hour:       { raw: hourStr,    values: parseField(hourStr,    0, 23) },
    dayOfMonth: { raw: domStr,     values: parseField(domStr,     1, 31) },
    month:      { raw: monthStr,   values: parseField(monthStr,   1, 12) },
    dayOfWeek:  { raw: dowStr,     values: parseField(dowStr,     0,  6) },
  };
}

/**
 * 주어진 Date 가 cron 표현식에 매칭되는지 확인합니다.
 * (초·밀리초는 무시하고 분 단위로 비교)
 *
 * @param expr    parseCron() 으로 파싱한 CronExpression
 * @param date    비교할 시각 (기본값: 현재 시각)
 */
export function matchesCron(expr: CronExpression, date: Date = new Date()): boolean {
  const minute     = date.getMinutes();
  const hour       = date.getHours();
  const dayOfMonth = date.getDate();
  const month      = date.getMonth() + 1; // JS: 0-indexed → 1-indexed
  const dayOfWeek  = date.getDay();       // 0=일, 6=토

  return (
    expr.minute.values.has(minute) &&
    expr.hour.values.has(hour) &&
    expr.dayOfMonth.values.has(dayOfMonth) &&
    expr.month.values.has(month) &&
    expr.dayOfWeek.values.has(dayOfWeek)
  );
}

/**
 * 주어진 cron 표현식 이후 가장 가까운 실행 시각을 계산합니다.
 * 최대 366일 앞까지 탐색하며, 일치하는 분이 없으면 null 반환.
 *
 * @param expression  5-field cron 문자열
 * @param from        탐색 시작 시각 (기본값: 현재 시각 + 1분)
 */
export function nextCronDate(expression: string, from?: Date): Date | null {
  const expr = parseCron(expression);
  // 현재 분부터가 아니라 다음 분부터 탐색
  const start = from ? new Date(from) : new Date();
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const MAX_ITERATIONS = 60 * 24 * 366; // 1년치 분
  const cursor = new Date(start);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (matchesCron(expr, cursor)) return new Date(cursor);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}
