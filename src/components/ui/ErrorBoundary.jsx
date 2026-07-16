import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * ErrorBoundary — catches render errors in its subtree, logs them, and shows a
 * centered fallback card. The "Reload" button clears the error state so the
 * subtree retries rendering (useful when wrapped with a key that resets it).
 *
 * Props:
 *   label    – optional; shown as "Something went wrong in {label}."
 *   children – the subtree to guard
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const { label } = this.props;
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
          <p className="font-semibold text-slate-700">
            Something went wrong {label ? `in ${label}` : 'in this section'}.
          </p>
          {this.state.error?.message && (
            <p className="text-xs text-slate-400 mt-1 max-w-md break-words">{this.state.error.message}</p>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 px-4 py-2 text-sm font-semibold border border-slate-300 text-slate-700 rounded hover:bg-slate-100"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}