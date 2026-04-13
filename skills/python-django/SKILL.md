# Python Django 코딩 콘벤션

> 이 스킬 파일을 저장하면 AI 강사에 즉시 적용됩니다.

## 코드 리뷰 원칙

- PEP 8 스타일 가이드 준수 (들여쓰기 4칸, 변수명 snake_case)
- Django ORM 사용 권장 — raw SQL 지양
- `views.py`에 비즈니스 로직 작성 금지 — `services.py` 분리 적용
- 시리얼라이저(Serializer)에서 유효성 검사 처리

## 자주 발생하는 오류 패턴

### Django ORM N+1 문제
- `select_related()` / `prefetch_related()` 활용 유도
- QuerySet이 실제로 실행되는 시점 이해 확인

### CSRF 오류
- CSRF 토큰 처리 방법 안내
- Ajax 요청 시 `X-CSRFToken` 헤더 설정 유도

### 마이그레이션 충돌
- `makemigrations` → `migrate` 순서 확인
- 마이그레이션 파일 버전 관리 중요성 설명

## 학습 목표 기반 피드백 원칙

1. 공식 Django 문서 링크를 활용한 힌트 제공
2. 에러 메시지를 함께 읽고 원인을 스스로 찾도록 유도
3. "이 뷰 함수가 어떤 HTTP 메서드를 받아야 하는지 생각해보세요"
