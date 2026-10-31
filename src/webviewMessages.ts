import type {
  Attachment,
  MemoryItem,
  MemoryStatus,
  MemoryType,
  Message,
  Order,
  OrderStatus,
} from "@br-ia/protocol";
import type { ConnectionState } from "./connection";
import type { PermissionMode } from "./cook/executor";

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
  /** « Tâche notée dans la mémoire du projet »… */
  noted: Record<MemoryType, string>;
  beta: string;
  /** « {0}/{1} en ligne » */
  online: string;
  refresh: string;
  more: string;
  tabChat: string;
  tabMemory: string;
  tabOrders: string;
  /** « Commande n° {0} » */
  order: string;
  orderStatus: Record<OrderStatus, string>;
  /** « Assigné à : cuisinier, sur la machine de {0} » */
  assignedTo: string;
  assignedNobody: string;
  noFolder: string;
  linkFolder: string;
  stopOrder: string;
  revertOrder: string;
  showTerminal: string;
  steps: string;
  noOrders: string;
  /** « Mode : {0} » */
  mode: string;
  modes: Record<PermissionMode, string>;
  changeMode: string;
  memoryGroups: Record<MemoryType | "history", string>;
  memoryStatus: Record<MemoryStatus, string>;
  noMemory: string;
  resolve: string;
  reopen: string;
  stopDecision: string;
  showInChat: string;
  openMemoryDocument: string;
  quickStatus: string;
  quickStatusMessage: string;
  quickMemory: string;
  quickTerminal: string;
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
      isChef: boolean;
      members: ChatMember[];
      onlineCount: number;
      messages: Message[];
      hasMore: boolean;
      loadingOlder: boolean;
      /** Ce que le serveur a noté dans la mémoire à partir de chaque message. */
      notes: Record<string, MemoryType[]>;
      memory: MemoryItem[];
      orders: Order[];
      /** Commandes dont les modifications peuvent être annulées sur cette machine. */
      revertable: string[];
      /** Un dossier est associé à ce projet sur cette machine. */
      folderLinked: boolean;
      permissionMode: PermissionMode;
    };

/** Extension → webview. */
export type ToWebview =
  | {
      type: "state";
      state: ChatViewState;
      connection: ConnectionState;
      strings: ChatStrings;
      locale: string;
      logoUri: string;
    }
  /** Résultat d'un envoi : en cas d'échec, la webview garde le brouillon. */
  | { type: "sendResult"; ok: boolean }
  /** Fichiers envoyés au serveur, à joindre au prochain message de ce projet. */
  | { type: "attached"; projectId: string; attachments: Attachment[] }
  /** Faire défiler jusqu'à un message et le mettre en évidence. */
  | { type: "reveal"; messageId: string };

/** Commandes de l'extension que la webview peut déclencher. */
export type WebviewCommand =
  | "showCookTerminal"
  | "openMemoryDocument"
  | "setPermissionMode"
  | "linkFolder"
  | "openChatInEditor"
  | "menu";

/** Webview → extension. */
export type FromWebview =
  | { type: "ready" }
  | { type: "signIn" }
  | { type: "connect" }
  | { type: "showLog" }
  | { type: "loadOlder" }
  | { type: "refresh" }
  | { type: "send"; body: string; replyToId?: string; mentions: string[]; attachmentIds: string[] }
  | { type: "attach"; pending: number }
  | { type: "openAttachment"; attachment: Attachment; save: boolean }
  | { type: "memoryStatus"; itemId: string; status: MemoryStatus }
  | { type: "orderAction"; orderId: string; action: "stop" | "revert" }
  | { type: "command"; command: WebviewCommand };
