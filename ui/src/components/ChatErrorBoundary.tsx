/**
 * 채팅 영역 전용 Error Boundary
 *
 * 특정 메시지의 마크다운·수식 렌더링 크래시 시
 * 페이지 전체 백화(White Screen) 대신 인라인 오류 UI로 Graceful Degradation.
 *
 * 사용:
 *   <ChatErrorBoundary>
 *     <Virtuoso ... />
 *   </ChatErrorBoundary>
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 개발 빌드에서만 원본 스택을 콘솔에 출력
    if (import.meta.env.DEV) {
      console.error('[ChatErrorBoundary]', error, info.componentStack);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
          <span className="text-4xl" role="img" aria-label="오류">️</span>
          <p className="font-semibold text-gray-700">메시지 렌더링에 실패했습니다.</p>
          <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
            일시적인 오류입니다. 아래 버튼을 눌러 다시 시도하거나
            페이지를 새로고침 해주세요.
          </p>
          <button
            onClick={this.handleReset}
            className="
              text-sm font-medium px-4 py-2
              bg-blue-500 hover:bg-blue-600
              text-white rounded-full transition
            "
          >
            다시 시도
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
