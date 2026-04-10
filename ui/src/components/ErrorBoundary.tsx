import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** 에러 발생 시 표시할 fallback UI (생략 시 기본값 사용) */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * ErrorBoundary — React 렌더링 오류 포착 컴포넌트
 *
 * 관리자·수강생 대시보드에서 null/undefined 데이터 등으로 인한
 * 렌더링 크래시 발생 시 화면 전체가 백지(White Screen)되는 것을 방지합니다.
 *
 * 사용법:
 *   <ErrorBoundary>
 *     <DocumentManager />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 운영환경에서 Sentry 등의 에러 수집 서비스로 전송하는 훅
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <span className="text-5xl mb-4">️</span>
          <h2 className="text-lg font-bold text-gray-800 mb-2">
            일시적인 오류가 발생했습니다
          </h2>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            화면을 렌더링하는 중 문제가 발생했습니다.
            {this.state.errorMessage && (
              <span className="block mt-1 font-mono text-xs text-red-400 break-all">
                {this.state.errorMessage}
              </span>
            )}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            다시 시도
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
