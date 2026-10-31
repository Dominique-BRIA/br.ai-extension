import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FromWebview, ToWebview } from "../src/webviewMessages";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };
const vscode = acquireVsCodeApi();

function App() {
  const [snapshot, setSnapshot] = useState<ToWebview | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "state") setSnapshot(event.data);
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!snapshot) return null;
  const { state, strings } = snapshot;

  switch (state.status) {
    case "connected":
      return <Panel title={strings.connectedTitle} body={strings.connectedBody} />;
    case "connecting":
      return <Panel title={strings.connectingTitle} body={strings.connectingBody} busy />;
    case "disconnected":
      return (
        <Panel title={strings.disconnectedTitle} body={strings.disconnectedBody}>
          <button type="button" className="primary" onClick={() => vscode.postMessage({ type: "connect" })}>
            {strings.connect}
          </button>
        </Panel>
      );
    case "failed":
      return (
        <Panel title={strings.failedTitle} body={state.message}>
          <button type="button" className="link" onClick={() => vscode.postMessage({ type: "showLog" })}>
            {strings.showLog}
          </button>
        </Panel>
      );
  }
}

function Panel(props: { title: string; body: string; busy?: boolean; children?: React.ReactNode }) {
  return (
    <section className="panel" aria-busy={props.busy ?? false} aria-live="polite">
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      {props.children && <div className="actions">{props.children}</div>}
    </section>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
