import React from 'react';

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="loading-screen">
          页面出现错误：{this.state.error.message}。请重新启动应用。
        </div>
      );
    return this.props.children;
  }
}
