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
  const [screen, setScreen] = useState<Screen>("main");

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === "state") setSnapshot(event.data);
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!snapshot) return null;
  const { state, strings, connection, locale, logoUri, wordmark, notifications, unread, settings, platform } =
    snapshot;

  const french = locale.startsWith("fr");
  const when = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
      : "";
  const platformMessage = platform ? (french ? platform.message.fr : platform.message.en) : "";
  if (platform?.state === "ongoing" && !platform.exempt) {
    return (
      <div className="maintenance" role="alert">
        <img src={logoUri} alt="" className="maintenance-logo" />
        <h1 className="auth-title">{strings.maintenanceTitle}</h1>
        <p className="auth-intro">{platformMessage}</p>
        {platform.endsAt && (
          <p className="meta">{strings.maintenanceBack.replace("{0}", when(platform.endsAt))}</p>
        )}
      </div>
    );
  }
  const maintenanceBanner =
    platform?.state === "scheduled" ? (
      <div className="maintenance-banner" role="status">
        <span className="codicon codicon-tools" aria-hidden="true" />
        <span>
          {strings.maintenanceBanner
            .replace("{0}", when(platform.startsAt))
            .replace(
              "{1}",
              String(
                platform.startsAt && platform.endsAt
                  ? Math.round((Date.parse(platform.endsAt) - Date.parse(platform.startsAt)) / 60_000)
                  : 0,
              ),
            )
            .replace("{2}", platformMessage)}
        </span>
      </div>
    ) : platform?.state === "ongoing" ? (
      <div className="maintenance-banner" role="status">
        <span className="codicon codicon-tools" aria-hidden="true" />
        <span>{strings.maintenanceExempt}</span>
      </div>
    ) : null;

  if (state.view === "signedOut") return <SignIn wordmark={wordmark} strings={strings} />;

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
        unread={unread}
        onScreen={setScreen}
      />
    );
  }

  return (
    <>
      {maintenanceBanner}
      {banner}
      {content}
    </>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
