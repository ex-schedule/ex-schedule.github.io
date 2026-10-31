import React, { ErrorInfo } from 'react';
import { Info } from 'lucide-react';


export class ErrorBoundary extends React.Component<any, any> {
  state = { hasError: false, error: null };
  constructor(props: any) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let message = "申し訳ありません。エラーが発生しました。";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          message = "アクセス権限がありません。管理者にお問い合わせください。";
        }
      } catch {
        // Not a JSON error
      }
      return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-bg p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-border max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Info size={32} />
            </div>
            <h2 className="text-xl font-bold text-text mb-2">エラーが発生しました</h2>
            <p className="text-text2 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent-d transition-colors"
            >
              再読み込み
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}
