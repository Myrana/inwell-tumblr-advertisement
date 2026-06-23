import { Component, ErrorInfo, ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

const localCacheKeys = [
  "inwell-ad-assistant-state",
  "inwell-tumblr-submit-targets",
  "inwell-tumblr-submission-queue",
  "inwell-saved-templates",
  "inwell-submission-queue",
  "inwell-tumblr-accounts",
  "inwell-queue-definitions",
  "inwell-runner-settings",
  "inwell-queue-schedule-settings",
  "inwell-tag-profiles",
];

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  private readonly handleWindowError = (event: ErrorEvent) => {
    this.setState({ error: event.error instanceof Error ? event.error : new Error(event.message || "Unexpected browser error.") });
  };

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    this.setState({ error: reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "Unexpected startup error.") });
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Inkwell workspace render failed", error, errorInfo);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetLocalCache = () => {
    localCacheKeys.forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="crash-shell" role="alert">
        <section className="crash-panel">
          <div>
            <p className="eyebrow">Workspace recovery</p>
            <h1>Inkwell hit a startup error.</h1>
            <p>The app stayed open so the bad session data can be cleared or retried.</p>
          </div>
          <pre>{this.state.error.message || "Unknown error"}</pre>
          <div className="crash-actions">
            <button type="button" onClick={this.reload}>
              Reload
            </button>
            <button className="secondary" type="button" onClick={this.resetLocalCache}>
              Reset local cache
            </button>
          </div>
        </section>
      </main>
    );
  }
}
