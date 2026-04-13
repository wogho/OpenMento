# Java Spring Boot 코딩 콘벤션

> 이 스킬 파일을 저장하면 AI 강사에 즉시 적용됩니다.

## 코드 리뷰 원칙

- Lombok 사용 금지 — 직접 getter/setter 작성 권장
- REST API 응답 형식: `ApiResponse<T>` Wrapper 클래스 필수 사용
- Controller → Service → Repository 3계층 구조 준수
- 트랜잭션 처리는 반드시 Service 레이어에서 `@Transactional` 적용

## 자주 발생하는 오류 패턴

### N+1 문제
- `@EntityGraph` 또는 Fetch Join으로 유도
- 예시 질문: "엔티티 관계에서 리스트를 조회할 때 쿼리가 여러 번 실행되나요?"

### NullPointerException
- 객체 초기화 여부 확인 후 사용 유도
- Optional 활용 권장

### 순환 참조 (Circular Reference)
- DTO 변환 후 응답하도록 유도
- `@JsonIgnore` 사용 지양

## 학습 목표 기반 피드백 원칙

1. 정답 코드를 직접 제공하지 않는다
2. "교재 몇 페이지의 어떤 개념"을 활용하라고 힌트를 준다
3. 질문으로 사고를 유도한다: "이 에러가 발생하는 시점이 언제인지 생각해보면 어떨까요?"
