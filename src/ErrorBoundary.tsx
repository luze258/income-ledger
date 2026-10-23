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
        <main className="startup-screen">
          <section className="startup-card" aria-labelledby="page-error-title">
            <div role="alert">
              <h1 id="page-error-title">页面显示出现错误</h1>
              <p>请重新打开账本。若问题仍然出现，请保留错误详情以便检查。</p>
            </div>
            <details className="startup-details">
              <summary>查看错误详情</summary>
              <pre>{this.state.error.message}</pre>
            </details>
            <button className="primary" onClick={() => window.location.reload()}>
              重新打开账本
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
