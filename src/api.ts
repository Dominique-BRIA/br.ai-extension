import {
  type ApiErrorCode,
  ATTACHMENT_NAME_HEADER,
  ATTACHMENT_TYPE_HEADER,
  type Attachment,
  type AttachmentResponse,
  apiError,
} from "@br-ia/protocol";
import { serverHttpUrl } from "./server";

/** Erreur renvoyée par le serveur, ou erreur réseau (`code` absent). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "network" | "unknown";

  constructor(status: number, code: ApiRequestError["code"], message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Client de l'API HTTP du serveur br.ia. */
export class Api {
  constructor(
    private readonly getToken: () => string | undefined,
    private readonly onUnauthenticated: () => void,
  ) {}

  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const response = await this.#fetch(method, path, {
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Envoie un fichier joint, en brut. */
  async upload(
    projectId: string,
    name: string,
    contentType: string,
    content: Uint8Array,
  ): Promise<Attachment> {
    const response = await this.#fetch("POST", `/projects/${projectId}/attachments`, {
      headers: {
        "Content-Type": "application/octet-stream",
        [ATTACHMENT_NAME_HEADER]: encodeURIComponent(name),
        [ATTACHMENT_TYPE_HEADER]: contentType,
      },
      // Copie dans un ArrayBuffer simple, accepté par fetch.
      body: new Uint8Array(content),
    });
    return ((await response.json()) as AttachmentResponse).attachment;
  }

  /** Télécharge le contenu d'une pièce jointe. */
  async download(attachmentId: string): Promise<Uint8Array> {
    const response = await this.#fetch("GET", `/attachments/${attachmentId}`, { headers: {} });
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Appelle le serveur et transforme toute réponse d'erreur en ApiRequestError. */
  async #fetch(method: Method, path: string, init: { headers: Record<string, string>; body?: BodyInit }) {
    const token = this.getToken();
    let response: Response;
    try {
      response = await fetch(`${serverHttpUrl()}${path}`, {
        method,
        headers: { ...init.headers, ...(token && { Authorization: `Bearer ${token}` }) },
        body: init.body,
      });
    } catch (error) {
      throw new ApiRequestError(0, "network", (error as Error).message);
    }
    if (response.ok) return response;

    const data: unknown = await response.json().catch(() => undefined);
    const parsed = apiError.safeParse(data);
    const code = parsed.success ? parsed.data.error.code : "unknown";
    const message = parsed.success ? parsed.data.error.message : `Erreur ${response.status}`;
    if (code === "unauthenticated" && token) this.onUnauthenticated();
    throw new ApiRequestError(response.status, code, message);
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body ?? {});
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  delete<T>(path: string, body?: unknown) {
    return this.request<T>("DELETE", path, body);
  }
}
