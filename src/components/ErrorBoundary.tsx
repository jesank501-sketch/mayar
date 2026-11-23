import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'Unexpected error',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      let parsedError: { error?: string; operationType?: string; path?: string } | null = null;
      try {
        parsedError = JSON.parse(this.state.message);
      } catch {
        parsedError = null;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold text-slate-900">
                সংযোগে সাময়িক সমস্যা হয়েছে
              </h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              {parsedError?.error
                ? `ডাটাবেস অপারেশন (${parsedError.operationType ?? 'read'}) সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।`
                : 'অ্যাপ্লিকেশন লোড করার সময় একটি ত্রুটি ঘটেছে। পেজটি রিলোড করে আবার চেষ্টা করুন।'}
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>রিলোড করুন</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
