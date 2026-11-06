import type {
  Attachment,
  Locale,
  MachineSession,
  MaintenanceStatus,
  MemoryItem,
  MemoryStatus,
  MemoryType,
  Message,
  Notification,
  Order,
  OrderStatus,
  ProjectRepo,
  SecretLogResponse,
  SecretsResponse,
  TeamUsage,
} from "@br-ia/protocol";
import type { ConnectionState } from "./connection";
import type { PermissionMode } from "./cook/executor";

/** Textes de l'interface, traduits côté extension puis transmis à la webview. */
export interface ChatStrings {
  emptyChatTitle: string;
  emptyChatBody: string;
  connecting: string;
  disconnected: string;
  connect: string;
  showLog: string;
  messageSending: string;
  messageSent: string;
  messageFailed: string;
  retrySend: string;
  discardSend: string;
  loadOlder: string;
  loading: string;
  reply: string;
  replyingTo: string;
  replyingToServeur: string;
  replyingToCuisinier: string;
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
  repoTitle: string;
  repoNone: string;
  repoAppConnected: string;
  linkRepo: string;
  changeRepo: string;
  cloneRepo: string;
  updateProject: string;
  orderNotPushed: string;
  orderPushed: string;
  orderMerged: string;
  relayOrder: string;
  handoffTitle: string;
  pushOrder: string;
  validateOrder: string;
  pullRequestLabel: string;
  stopOrder: string;
  revertOrder: string;
  showTerminal: string;
  steps: string;
  noOrders: string;
  newOrder: string;
  orderTitleLabel: string;
  orderTitlePlaceholder: string;
  orderBriefLabel: string;
  orderBriefPlaceholder: string;
  placeOrder: string;
  cancelOrderForm: string;
  orderMachineHint: string;
  orderOnCloud: string;
  orderOnCloudHint: string;
  orderCloudWait: string;
  onCloudMachine: string;
  /** « Mode : {0} » */
  mode: string;
  modes: Record<PermissionMode, string>;
  /** Ce que chaque mode permet, sous son nom dans le menu du champ de saisie. */
  modeDetails: Record<PermissionMode, string>;
  modeTitle: string;
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
  tabTeam: string;
  online_pill: string;
  ordersInProgress: string;
  /** « {0} active(s) » */
  activeCount: string;
  /** « Demandée par {0} » */
  requestedBy: string;
  /** « Étape {0} : {1} » */
  stepOf: string;
  cook: string;
  /** « sur la machine de {0} » */
  onMachine: string;
  waitingMachine: string;
  cookStatus: { busy: string; ready: string; waiting: string };
  viewStream: string;
  details: string;
  filterAll: string;
  filterRunning: string;
  filterDone: string;
  /** « Terminée {0} » (avec une durée relative) */
  finishedAgo: string;
  startsWhenMachine: string;
  /** « File d'attente : #{0} » */
  queuePosition: string;
  openFile: string;
  memoryTitle: string;
  /** « Base de connaissances du projet {0} » */
  memorySubtitle: string;
  inProgress: string;
  byCook: string;
  preview: string;
  recentDocuments: string;
  /** « {0} fichier(s) » */
  fileCount: string;
  /** « Commande n° {0} » pour un document */
  fromOrder: string;
  activeDecision: string;
  newNote: string;
  /** « Équipe {0} » */
  teamTitle: string;
  workspace: string;
  /** « {0} humain(s) · {1} agents IA » */
  teamStats: string;
  teamMembers: string;
  /** « {0} actif(s) » */
  activeMembers: string;
  aiAgents: string;
  serveurRole: string;
  cuisinierRole: string;
  agentActive: string;
  agentUnavailable: string;
  roleChef: string;
  roleMember: string;
  youBadge: string;
  onlineNow: string;
  /** « Vu {0} » */
  seenAgo: string;
  neverSeen: string;
  invite: string;
  lendMachine: string;
  /** Connexion */
  authWelcome: string;
  authIntro: string;
  emailLabel: string;
  emailPlaceholder: string;
  getCode: string;
  continue: string;
  nameTitle: string;
  nameIntro: string;
  nameLabel: string;
  codeTitle: string;
  /** « Saisissez le code à 6 chiffres envoyé à {0}. » */
  codeIntro: string;
  codeLabel: string;
  signInButton: string;
  resendCode: string;
  codeResent: string;
  changeEmail: string;
  back: string;
  invalidEmail: string;
  codeInvalid: string;
  invitationInvalid: string;
  codeAlreadySent: string;
  serverUnreachable: string;
  authFooter: string;
  /** Accueil */
  homeGreeting: string;
  homeIntro: string;
  yourTeams: string;
  noTeamsTitle: string;
  noTeamsBody: string;
  createTeam: string;
  teamNamePlaceholder: string;
  joinTeam: string;
  teamKeyPlaceholder: string;
  join: string;
  create: string;
  cancel: string;
  newProject: string;
  projectNamePlaceholder: string;
  noProjects: string;
  projectCount: string;
  account: string;
  editProfile: string;
  machines: string;
  signOut: string;
  allProjects: string;
  /** Clé d'invitation et gestion de l'équipe */
  inviteKeyTitle: string;
  inviteKeyIntro: string;
  inviteKeyNone: string;
  inviteKeyMember: string;
  generateKey: string;
  newKey: string;
  copy: string;
  copied: string;
  validUntil: string;
  leaveTeam: string;
  removeMember: string;
  makeChef: string;
  /** Notifications */
  notificationsTitle: string;
  noNotifications: string;
  /** « {0} vous a mentionné » */
  notifMention: string;
  notifReply: string;
  newBadge: string;
  /** Réglages */
  settingsTitle: string;
  profileSection: string;
  emailLanguage: string;
  save: string;
  saved: string;
  machineSection: string;
  lendMachineDetail: string;
  showTerminalLabel: string;
  notifyLabel: string;
  localMemorySection: string;
  localMemoryDetail: string;
  machinesSection: string;
  thisMachine: string;
  serverSection: string;
  serverUrlLabel: string;
  deleteAccount: string;
  /** « Version {0} » */
  version: string;
  /** Résumé d'absence */
  catchUpTitle: string;
  /** « {0} nouveau(x) message(s) » */
  catchUpCount: string;
  catchUpLoading: string;
  close: string;
  renameProject: string;
  archiveProject: string;
  feedbackTitle: string;
  feedbackPlaceholder: string;
  feedbackSend: string;
  feedbackThanks: string;
  /** Changement d'adresse */
  editEmail: string;
  newEmailLabel: string;
  sendCode: string;
  /** « Saisissez le code envoyé à {0}. » */
  emailCodeIntro: string;
  confirm: string;
  emailChanged: string;
  emailTaken: string;
  /** Formule et crédits */
  planTitle: string;
  planUntil: string;
  creditsUsed: string;
  bonusCredits: string;
  planLimits: string;
  usageByMember: string;
  betaFree: string;
  enterCode: string;
  promoPlaceholder: string;
  noCreditsChef: string;
  noCreditsMember: string;
  apply: string;
  /** Maintenance */
  maintenanceTitle: string;
  maintenanceBack: string;
  maintenanceBanner: string;
  maintenanceExempt: string;
  /** Coffre de secrets */
  vaultTitle: string;
  vaultDisabled: string;
  vaultEmpty: string;
  vaultNoneForYou: string;
  /** « Accès : {0} » */
  accessLabel: string;
  chefOnly: string;
  addSecret: string;
  secretName: string;
  secretValue: string;
  newValuePlaceholder: string;
  whoHasAccess: string;
  writeEnv: string;
  envNeedsFolder: string;
  vaultLog: string;
  logActions: Record<"created" | "updated" | "deleted" | "read", string>;
  edit: string;
  remove: string;
}

export interface HomeTeam {
  id: string;
  name: string;
  isChef: boolean;
  memberCount: number;
  onlineCount: number;
  projects: { id: string; name: string }[];
}

/** Un message en route : l'horloge tant qu'il part, puis la coche une fois enregistré. */
export interface OutgoingMessage {
  clientId: string;
  body: string;
  replyTo: Message["replyTo"];
  attachments: Attachment[];
  createdAt: string;
  status: "sending" | "failed";
}

export interface TeamInvitation {
  code: string;
  expiresAt: string;
}

/** Formulaires de l'accueil, dont la webview attend le résultat. */
export type HomeForm =
  | "createTeam"
  | "joinTeam"
  | "createProject"
  | "renameProject"
  | "feedback"
  | "createSecret"
  | "updateSecret";

export interface ChatMember {
  userId: string;
  displayName: string;
  role: "chef" | "membre";
  online: boolean;
  lastSeenAt: string | null;
}

export type ChatViewState =
  | { view: "signedOut" }
  | {
      view: "home";
      user: { displayName: string; email: string };
      /** Absent tant que l'espace de travail n'est pas chargé. */
      teams: HomeTeam[] | null;
    }
  | {
      view: "project";
      projectId: string;
      projectName: string;
      teamId: string;
      teamName: string;
      chefName: string;
      /** Clé d'invitation en cours (chef seulement) ; `undefined` tant qu'elle n'est pas chargée. */
      invitation?: TeamInvitation | null;
      myUserId: string;
      isChef: boolean;
      members: ChatMember[];
      onlineCount: number;
      messages: Message[];
      /** Une machine cloud est en service : le formulaire de commande propose ce choix. */
      cloudAvailable: boolean;
      /** Messages du membre partis du panneau, pas encore enregistrés par le serveur. */
      outgoing: OutgoingMessage[];
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
      /** Dépôt GitHub branché au projet. */
      repo: ProjectRepo | null;
      permissionMode: PermissionMode;
      /** Résumé « pendant votre absence », affiché en haut du chat jusqu'à ce qu'on le ferme. */
      catchUp: CatchUp | null;
      /** Formule et consommation de l'équipe ; `undefined` tant qu'elles ne sont pas chargées. */
      usage?: TeamUsage;
      /** Coffre de secrets du projet ; `undefined` tant qu'il n'est pas chargé. */
      vault?: SecretsResponse;
    };

export interface CatchUp {
  /** Nombre de messages des autres depuis la dernière visite. */
  count: number;
  /** Résumé en Markdown, ou `null` pendant qu'il se prépare. */
  summary: string | null;
  since: string;
}

/** Les réglages du membre et de cette machine. */
export interface PanelSettings {
  displayName: string;
  email: string;
  locale: Locale;
  permissionMode: PermissionMode;
  lendMachine: boolean;
  showCookTerminal: boolean;
  notifyMentions: boolean;
  serverUrl: string;
  version: string;
  localMemoryFile: string;
}

/** Extension → webview. */
export type ToWebview =
  | { type: "orderCreated"; ok: boolean; message: string }
  | {
      type: "state";
      state: ChatViewState;
      connection: ConnectionState;
      strings: ChatStrings;
      locale: string;
      logoUri: string;
      /** Le logo complet, avec le nom et la devise, pour l'écran de connexion. */
      wordmark: { light: string; dark: string };
      notifications: Notification[];
      unread: number;
      /** Maintenance annoncée ou en cours ; `null` tant que l'état n'est pas connu. */
      platform: MaintenanceStatus | null;
      /** Absent hors connexion. */
      settings: PanelSettings | null;
    }
  /** Réponse à une étape du changement d'adresse ; `error` est le code d'erreur du serveur. */
  | { type: "emailResult"; step: "request" | "verify"; ok: boolean; error?: string; message?: string }
  /** Réponse à la saisie d'un code : ce qu'il a changé, ou pourquoi il est refusé. */
  | { type: "promoResult"; ok: boolean; message: string }
  /** Le journal du coffre du projet ouvert (chef). */
  | { type: "secretLog"; entries: SecretLogResponse["entries"] }
  /** Les machines connectées au compte, pour les réglages. */
  | { type: "machines"; machines: MachineSession[] }
  /** Résultat d'un envoi : en cas d'échec, la webview garde le brouillon. */
  /** Fichiers envoyés au serveur, à joindre au prochain message de ce projet. */
  | { type: "attached"; projectId: string; attachments: Attachment[] }
  /** Faire défiler jusqu'à un message et le mettre en évidence. */
  | { type: "reveal"; messageId: string }
  /** Réponse à une étape de connexion ; `error` est le code d'erreur du serveur, `message` son texte. */
  | {
      type: "authResult";
      step: "requestCode" | "verifyCode";
      ok: boolean;
      newAccount?: boolean;
      error?: string;
      message?: string;
    }
  | { type: "formResult"; form: HomeForm; ok: boolean; error?: string };

/** Commandes de l'extension que la webview peut déclencher. */
export type WebviewCommand =
  | "showCookTerminal"
  | "openMemoryDocument"
  | "setPermissionMode"
  | "linkFolder"
  | "linkRepo"
  | "cloneRepo"
  | "updateProject"
  | "openChatInEditor"
  | "newNote"
  | "invite"
  | "toggleLending"
  | "leaveTeam"
  | "editProfile"
  | "manageMachines"
  | "signOut"
  | "deleteAccount";

/** Webview → extension. */
export type FromWebview =
  | { type: "ready" }
  | { type: "requestCode"; email: string }
  | { type: "verifyCode"; email: string; code: string; displayName?: string }
  | { type: "openProject"; projectId: string | null }
  | { type: "createTeam"; name: string }
  | { type: "joinTeam"; code: string }
  | { type: "createProject"; teamId: string; name: string }
  | { type: "renameProject"; projectId: string; name: string }
  | { type: "archiveProject"; projectId: string }
  | { type: "sendFeedback"; text: string }
  | { type: "invitation"; action: "load" | "create" }
  | { type: "copy"; text: string }
  | { type: "memberAction"; userId: string; action: "remove" | "transfer" }
  | { type: "updateProfile"; displayName?: string; locale?: Locale }
  | { type: "setSetting"; key: "lendMachine" | "showCookTerminal" | "notifyMentions"; value: boolean }
  | { type: "setServerUrl"; url: string }
  | { type: "changeEmail"; email: string }
  | { type: "verifyEmail"; email: string; code: string }
  | { type: "openLocalMemory" }
  | { type: "loadMachines" }
  | { type: "signOutMachine"; sessionId: string }
  | { type: "notificationsSeen" }
  | { type: "openNotification"; projectId: string; messageId: string | null }
  | { type: "dismissCatchUp" }
  | { type: "vault"; action: "load" | "log" | "writeEnv" }
  | { type: "usage" }
  | { type: "redeemPromo"; code: string }
  | { type: "createSecret"; name: string; value: string; access: string[] }
  | { type: "updateSecret"; id: string; value?: string; access?: string[] }
  | { type: "deleteSecret"; id: string }
  | { type: "setPermissionMode"; mode: PermissionMode }
  | { type: "connect" }
  | { type: "showLog" }
  | { type: "loadOlder" }
  | { type: "refresh" }
  | {
      type: "send";
      /** Identifiant local du message, tant que le serveur ne l'a pas enregistré. */
      clientId: string;
      body: string;
      replyToId?: string;
      mentions: string[];
      attachments: Attachment[];
    }
  | { type: "retrySend"; clientId: string }
  | { type: "discardSend"; clientId: string }
  | { type: "attach"; pending: number }
  | { type: "openAttachment"; attachment: Attachment; save: boolean }
  | { type: "memoryStatus"; itemId: string; status: MemoryStatus }
  | { type: "createOrder"; title: string; brief: string; runOn: "member" | "cloud" }
  | { type: "orderAction"; orderId: string; action: "stop" | "revert" | "push" | "validate" | "relay" }
  | { type: "command"; command: WebviewCommand }
  /** Ouvrir un fichier du projet sur cette machine (chemin relatif au dossier associé). */
  | { type: "openProjectFile"; path: string };
