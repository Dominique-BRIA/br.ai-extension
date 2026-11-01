import "@vscode/codicons/dist/codicon.css";
import "./styles.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToWebview } from "../src/webviewMessages";
import { Chat } from "./Chat";
import type { Screen } from "./Header";
import { Home } from "./Home";
import { Notifications, ScreenHeader } from "./Notifications";
import { Settings } from "./Settings";
import { SignIn } from "./SignIn";
import { VaultSection } from "./Vault";
import { post } from "./vscodeApi";

type Snapshot = Extract<ToWebview, { type: "state" }>;

/** Le panneau : la connexion, puis l'accueil (équipes et projets), puis le projet ouvert. */
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [screen, setScreen] = useState<Screen>("main");

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
  const { state, strings, connection, locale, logoUri, wordmarkUri, notifications, unread, settings } =
    snapshot;

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

  const back = () => setScreen("main");
  let content: React.ReactNode;
  if (screen === "notifications") {
    content = (
      <Notifications
        items={notifications}
        unread={unread}
        strings={strings}
        locale={locale}
        onBack={back}
        onOpen={back}
      />
    );
  } else if (screen === "settings" && settings) {
    content = <Settings settings={settings} strings={strings} locale={locale} onBack={back} />;
  } else if (screen === "vault" && state.view === "project") {
    content = (
      <div className="panel-root">
        <ScreenHeader
          title={`${strings.vaultTitle} · ${state.projectName}`}
          strings={strings}
          onBack={back}
        />
        <div className="tab-body">
          <VaultSection
            vault={state.vault}
            members={state.members}
            isChef={state.isChef}
            folderLinked={state.folderLinked}
            strings={strings}
            locale={locale}
          />
        </div>
      </div>
    );
  } else if (state.view === "home") {
    content = (
      <Home
        user={state.user}
        teams={state.teams}
        logoUri={logoUri}
        connected={connected}
        unread={unread}
        onScreen={setScreen}
        strings={strings}
      />
    );
  } else {
    content = (
      <Chat
        state={state}
        strings={strings}
        locale={locale}
        logoUri={logoUri}
        connected={connected}
        sentCount={sentCount}
        unread={unread}
        onScreen={setScreen}
      />
    );
  }

  return (
    <>
      {banner}
      {content}
    </>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
