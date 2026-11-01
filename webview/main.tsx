import "@vscode/codicons/dist/codicon.css";
import "./styles.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToWebview } from "../src/webviewMessages";
import { Chat } from "./Chat";
import { Home } from "./Home";
import { SignIn } from "./SignIn";
import { post } from "./vscodeApi";

type Snapshot = Extract<ToWebview, { type: "state" }>;

/** Le panneau : la connexion, puis l'accueil (équipes et projets), puis le projet ouvert. */
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
  const { state, strings, connection, locale, logoUri, wordmarkUri } = snapshot;

  if (state.view === "signedOut") return <SignIn wordmarkUri={wordmarkUri} strings={strings} />;

  const connected = connection.status === "connected";
  const banner = connected ? null : (
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

  return (
    <>
      {banner}
      {state.view === "home" ? (
        <Home
          user={state.user}
          teams={state.teams}
          logoUri={logoUri}
          connected={connected}
          strings={strings}
        />
      ) : (
        <Chat
          state={state}
          strings={strings}
          locale={locale}
          logoUri={logoUri}
          connected={connected}
          sentCount={sentCount}
        />
      )}
    </>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
