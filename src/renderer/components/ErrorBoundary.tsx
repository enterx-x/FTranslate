import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export function getErrorBoundaryMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '页面加载失败，请返回后重试。';
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Lazy page render failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <main className="lazy-page-error" role="alert">
          {getErrorBoundaryMessage(this.state.error)}
        </main>
      );
    }

    return this.props.children;
  }
}
