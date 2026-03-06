import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              Algo salió mal
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              Ocurrió un error inesperado. Tus datos no se han perdido.
            </p>
            {this.state.error && import.meta.env.DEV && (
              <pre className="mb-4 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-left text-xs text-red-600">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                }}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
              >
                Reintentar
              </button>
              <a
                href="/vehicles"
                className="text-sm text-slate-500 underline"
              >
                Volver al inicio
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
