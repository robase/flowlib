import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logToHost } from './vscode-bridge';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render errors so the webview never dies silently. Logs to the
 * host's `Invect (Webview)` OutputChannel and shows a usable fallback the
 * user can read (and hopefully copy + report).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logToHost('error', 'webview render error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flowlib-fallback">
          <h2>Webview crashed</h2>
          <p>{this.state.error.message}</p>
          <p style={{ fontSize: 11, opacity: 0.6 }}>{this.state.error.stack}</p>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
