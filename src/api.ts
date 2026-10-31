import { type ApiErrorCode, apiError } from "@br-ia/protocol";
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
    const token = this.getToken();
    let response: Response;
    try {
      response = await fetch(`${serverHttpUrl()}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { "Content-Type": "application/json" }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new ApiRequestError(0, "network", (error as Error).message);
    }

    if (response.status === 204) return undefined as T;
    const data: unknown = await response.json().catch(() => undefined);
    if (response.ok) return data as T;

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
  delete<T>(path: string) {
    return this.request<T>("DELETE", path);
  }
}
