/**
 * Socket.io 이벤트 핸들러 (Phase 1-4)
 *
 * 이벤트 플로우:
 *   client → join_session(sessionId)        : 세션 룸 입장
 *   client → chat_message({ question, ... }) : 질문 전송
 *   server → typing_start                   : "AI가 답변 중..." 표시
 *   server → chat_chunk({ chunk })           : 스트리밍 텍스트 조각
 *   server → chat_done({ sessionId, ... })   : 응답 완료 + 메타데이터
 *   server → chat_error({ message })         : 에러 발생
 */

import type { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { tutorChat } from '../services/tutor-agent.js';

interface JwtPayload {
  sub: string;
  institutionId: string;
  role: string;
}

interface ChatMessagePayload {
  question: string;
  agentId: string;
  sessionId?: string;
  courseId?: string;
}

let io: SocketServer | null = null;

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new Server(httpServer, {
    cors: {
      // 개발환경: Vite 개발 서버 허용. 프로덕션은 환경변수로 도메인 제한
      origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // ── JWT 인증 미들웨어 ──────────────────────────────────
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth.token as string | undefined) ??
      (socket.handshake.headers.authorization?.replace('Bearer ', '') ?? '');

    if (!token) {
      return next(new Error('인증 토큰이 필요합니다.'));
    }

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error('서버 설정 오류'));

      const payload = verify(token, secret) as JwtPayload;
      socket.data.userId = payload.sub;
      socket.data.institutionId = payload.institutionId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error('유효하지 않은 토큰입니다.'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, institutionId } = socket.data as {
      userId: string;
      institutionId: string;
    };

    // ── 세션 룸 입장 ──────────────────────────────────────
    socket.on('join_session', (sessionId: string) => {
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        socket.join(`session:${sessionId}`);
      }
    });

    // ── 개인 Room 자동 입장 (Phase 2-5: GitHub 코드 리뷰 Push 대상) ──────
    // 연결 즉시 student:<userId> 룸에 입장하여 서버 Push 이벤트를 수신합니다.
    socket.join(`student:${userId}`);
    // ── 채팅 메시지 수신 → LLM 스트리밍 응답 ─────────────
    socket.on('chat_message', async (payload: ChatMessagePayload) => {
      const { question, agentId, sessionId, courseId } = payload ?? {};

      if (!question || !agentId) {
        socket.emit('chat_error', { message: '필수 파라미터가 누락되었습니다.' });
        return;
      }

      // "AI가 답변 중..." 타이핑 인디케이터 시작
      socket.emit('typing_start');

      try {
        // tutorChat은 전체 응답을 반환하므로,
        // 현재는 완료 후 한 번에 전송하고 chunk 이벤트로 래핑합니다.
        // Phase 3에서 LLM 스트리밍 API 전환 시 chunk 단위 emit으로 교체합니다.
        const result = await tutorChat({
          sessionId,
          studentId: userId,
          institutionId,
          courseId,
          question,
          agentId,
        });

        // 응답을 단어 단위 청크로 나누어 스트리밍 효과 시뮬레이션
        const words = result.answer.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = i === 0 ? words[i] : ' ' + words[i];
          socket.emit('chat_chunk', { chunk });
          // 단어 사이 미세한 지연으로 타이핑 효과 (20~40ms)
          await new Promise((r) => setTimeout(r, 20 + Math.random() * 20));
        }

        socket.emit('chat_done', {
          sessionId: result.sessionId,
          ragSourceCount: result.ragSourceCount,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
      } catch (err) {
        socket.emit('chat_error', {
          message: err instanceof Error ? err.message : '답변 생성 중 오류가 발생했습니다.',
        });
      }
    });
  });

  return io;
}

export { io };
