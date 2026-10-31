import type { FromWebview } from "../src/webviewMessages";

interface PersistedState {
  /** Brouillons non envoyés, par projet. */
  drafts?: Record<string, string>;
}

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
  getState(): PersistedState | undefined;
  setState(state: PersistedState): void;
};

const api = acquireVsCodeApi();

export const post = (message: FromWebview) => api.postMessage(message);

export function loadDraft(projectId: string): string {
  return api.getState()?.drafts?.[projectId] ?? "";
}

export function saveDraft(projectId: string, text: string): void {
  const state = api.getState() ?? {};
  const drafts = { ...state.drafts };
  if (text) drafts[projectId] = text;
  else delete drafts[projectId];
  api.setState({ ...state, drafts });
}
