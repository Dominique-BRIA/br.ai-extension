import type { Attachment, Message } from "@br-ia/protocol";
import type { ConnectionState } from "./connection";

/** Textes de l'interface, traduits côté extension puis transmis à la webview. */
export interface ChatStrings {
  signedOutTitle: string;
  signedOutBody: string;
  signIn: string;
  noProjectTitle: string;
  noProjectBody: string;
  emptyChatTitle: string;
  emptyChatBody: string;
  connecting: string;
  disconnected: string;
  connect: string;
  showLog: string;
  loadOlder: string;
  loading: string;
  reply: string;
  replyingTo: string;
  cancelReply: string;
  composerPlaceholder: string;
  composerHint: string;
  send: string;
  today: string;
  yesterday: string;
  formerMember: string;
  serveur: string;
  cuisinier: string;
  mentionsYou: string;
  /** Modèle « {0} (vous) » pour ses propres messages. */
  you: string;
  attach: string;
  removeAttachment: string;
  download: string;
  diagramError: string;
}

export interface ChatMember {
  userId: string;
  displayName: string;
}

export type ChatViewState =
  | { view: "signedOut" }
  | { view: "noProject" }
  | {
      view: "project";
      projectId: string;
      projectName: string;
      teamName: string;
      myUserId: string;
      members: ChatMember[];
      messages: Message[];
      hasMore: boolean;
      loadingOlder: boolean;
    };

/** Extension → webview. */
export type ToWebview =
  | {
      type: "state";
      state: ChatViewState;
      connection: ConnectionState;
      strings: ChatStrings;
      locale: string;
    }
  /** Résultat d'un envoi : en cas d'échec, la webview garde le brouillon. */
  | { type: "sendResult"; ok: boolean }
  /** Fichiers envoyés au serveur, à joindre au prochain message de ce projet. */
  | { type: "attached"; projectId: string; attachments: Attachment[] };

/** Webview → extension. */
export type FromWebview =
  | { type: "ready" }
  | { type: "signIn" }
  | { type: "connect" }
  | { type: "showLog" }
  | { type: "loadOlder" }
  | { type: "send"; body: string; replyToId?: string; mentions: string[]; attachmentIds: string[] }
  | { type: "attach"; pending: number }
  | { type: "openAttachment"; attachment: Attachment; save: boolean };
