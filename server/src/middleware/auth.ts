import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types/auth.js';

// Fail-Fast: 모듈 로드 시점에 JWT_SECRET 검증 (1회 캐싱)
// 환경 변수 누락 시 서버 구동 즉시 종료 — 운영 중 런타임 에러 원천 차단
const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET 환경 변수가 설정되지 않았습니다. 서버를 시작할 수 없습니다.',
    );
  }
  return secret;
})();

/**
 * JWT Bearer 토큰을 검증하고 req.user 에 페이로드를 주입합니다.
 *
 * Authorization: Bearer <token>
 *
 * 인증 실패 시: 401 Unauthorized
 * 토큰 만료 시: 401 (TokenExpiredError 구분)
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization 헤더가 없거나 형식이 올바르지 않습니다.' });
    return;
  }

  const token = authHeader.slice(7); // "Bearer " 제거

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: '토큰이 만료되었습니다.' });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
      return;
    }
    next(err);
  }
}

/**
 * 단기 JWT 발급 유틸리티 (paperclip agent-auth-jwt.ts 패턴 차용)
 *
 * - 일반 사용자 토큰: 8시간 유효
 * - 에이전트 실행 토큰: expiresIn 을 짧게 지정 (Phase 2 Heartbeat에서 활용)
 */
export function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  expiresIn: string | number = '8h',
): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}
