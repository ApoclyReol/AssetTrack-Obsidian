import { Component, type ErrorInfo, type ReactNode } from "react";
import { displayError, t } from "../i18n";

export class AssetTrackErrorBoundary extends Component<
  { children?: ReactNode; onReload: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Rendering errors stay in the local view; diagnostics remain user-triggered.
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="asset-track-status is-error" role="alert">
        <h2>{t("界面无法继续显示", "The view could not continue rendering")}</h2>
        <p>{displayError(this.state.error)}</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReload();
          }}
        >
          {t("重新加载", "Reload")}
        </button>
      </section>
    );
  }
}
