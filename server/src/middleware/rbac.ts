import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types/auth.js';

/**
 * RBAC (Role-Based Access Control) 미들웨어 팩토리
 *
 * 사용 예시:
 *   router.use(authenticate, requireRole('admin'))
 *   router.use(authenticate, requireRole('instructor', 'admin'))
 *
 * 권한 없음 시: 403 Forbidden
 * ※ authenticate 미들웨어 실행 후에만 사용 가능 (req.user 주입 전제)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Guard: authenticate 미들웨어 누락 시 서버 크래시 방지
    if (!req.user) {
      res.status(401).json({ error: '인증이 필요합니다.' });
      return;
    }

    const { role } = req.user;

    if (!allowedRoles.includes(role)) {
      res.status(403).json({
        error: '접근 권한이 없습니다.',
        required: allowedRoles,
        current: role,
      });
      return;
    }

    next();
  };
}

/**
 * 멀티 테넌트 격리 미들웨어
 *
 * 요청의 institutionId 파라미터가 JWT 페이로드의 institutionId 와 일치하는지 확인합니다.
 * admin 역할은 institutionId 제한 없이 접근 가능합니다.
 *
 * 사용 예시:
 *   router.get('/:institutionId/courses', authenticate, requireSameInstitution)
 */
export function requireSameInstitution(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Guard: authenticate 미들웨어 누락 시 서버 크래시 방지
  if (!req.user) {
    res.status(401).json({ error: '인증이 필요합니다.' });
    return;
  }

  const { role, institutionId } = req.user;

  // admin은 전 기관 접근 허용
  if (role === 'admin') {
    next();
    return;
  }

  const paramInstitutionId = req.params['institutionId'];

  if (paramInstitutionId && paramInstitutionId !== institutionId) {
    res.status(403).json({ error: '다른 기관의 데이터에 접근할 수 없습니다.' });
    return;
  }

  next();
}
