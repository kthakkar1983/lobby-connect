import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/react";

/** After a render crash, auto-recover the unattended kiosk to a fresh state. */
const RELOAD_AFTER_MS = 8_000;

interface Props {
  readonly children: ReactNode;
}
interface State {
  readonly hasError: boolean;
}

/**
 * Catches React render/lifecycle errors so a component crash doesn't leave the
 * kiosk on a blank white screen (React 19 unmounts the whole tree on an
 * uncaught error). Reports to Sentry, then reloads to return to the welcome
 * screen — the tablet is unattended, so it must self-heal. (Async/event-handler
 * errors are caught by Sentry's global handlers, not here; a renderer-process
 * hard crash is uncatchable by any in-page code.)
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    Sentry.captureException(error);
    this.timer = setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
  }

  override componentWillUnmount(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            textAlign: "center",
          }}
        >
          <div>
            <p style={{ fontSize: 26 }}>One moment…</p>
            <p style={{ fontSize: 20, color: "var(--color-muted-foreground)" }}>
              Returning to the welcome screen.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
