import "@vscode/codicons/dist/codicon.css";
import "./styles.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToWebview } from "../src/webviewMessages";
import { Chat } from "./Chat";
import { post } from "./vscodeApi";

type Snapshot = Extract<ToWebview, { type: "state" }>;

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "state") setSnapshot(event.data);
      if (event.data.type === "sendResult" && event.data.ok) setSentCount((count) => count + 1);
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!snapshot) return null;
  const { state, strings, connection, locale } = snapshot;

  if (state.view === "signedOut") {
    return (
      <Panel title={strings.signedOutTitle} body={strings.signedOutBody}>
        <button type="button" className="primary" onClick={() => post({ type: "signIn" })}>
          {strings.signIn}
        </button>
      </Panel>
    );
  }

  const banner =
    connection.status === "connected" ? null : (
      <div className="banner" role="status">
        <span>
          {connection.status === "connecting"
            ? strings.connecting
            : connection.status === "failed"
              ? connection.message
              : strings.disconnected}
        </span>
        {connection.status === "disconnected" && (
          <button type="button" className="link" onClick={() => post({ type: "connect" })}>
            {strings.connect}
          </button>
        )}
        {connection.status === "failed" && (
          <button type="button" className="link" onClick={() => post({ type: "showLog" })}>
            {strings.showLog}
          </button>
        )}
      </div>
    );

  if (state.view === "noProject") {
    return (
      <>
        {banner}
        <Panel title={strings.noProjectTitle} body={strings.noProjectBody} />
      </>
    );
  }

  return (
    <>
      {banner}
      <Chat state={state} strings={strings} locale={locale} sentCount={sentCount} />
    </>
  );
}

function Panel(props: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="panel" aria-live="polite">
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      {props.children && <div className="actions">{props.children}</div>}
    </section>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
