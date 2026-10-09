import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            {/* role="alert": when the boundary trips it replaces the page
                the member was on, and until now it did so silently - a screen
                reader kept reading the tree it had, which is gone. The role
                goes on the heading and not the wrapper on purpose: the
                wrapper holds the stack trace, and reading a stack aloud
                helps nobody. */}
            <h2 role="alert" className="text-xl mb-4">This page didn't load. Reload to try again.</h2>

            {/* R47: a player needs the way forward, not the stack. It stays
                one tap away for whoever reports the bug. */}
            <details className="w-full mb-6">
              <summary className="cursor-pointer text-sm text-muted-foreground mb-2">Details for a bug report</summary>
              <div className="p-4 w-full rounded bg-muted overflow-auto">
                <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                  {this.state.error?.stack}
                </pre>
              </div>
            </details>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
