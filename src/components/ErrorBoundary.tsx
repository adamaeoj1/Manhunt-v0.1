'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ManhuntErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected UI error occurred.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AUI Manhunt ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-canvas text-ink">
          <div className="aui-card max-w-md w-full p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-700 font-bold text-xl flex items-center justify-center mx-auto">
              !
            </div>
            <h2 className="font-display font-bold text-xl text-ink">Something went wrong</h2>
            <p className="text-xs text-ink-secondary leading-relaxed">
              {this.state.errorMessage || 'A temporary display issue occurred. Your game session is safe.'}
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="btn-cedar min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold"
              >
                Recover View
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn-secondary min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
