import type { Message } from "@br-ia/protocol";
import { describe, expect, it } from "vitest";
import type { ChatStrings } from "../src/webviewMessages";
import { authorName, continuesPrevious, formatDay, formatSize } from "../webview/format";

const strings = { today: "Aujourd'hui", yesterday: "Hier" } as ChatStrings;

const message = (overrides: Partial<Message>): Message => ({
  id: crypto.randomUUID(),
  projectId: "p",
  author: { kind: "member", userId: "u1", displayName: "Ali" },
  body: "texte",
  replyTo: null,
  mentions: [],
  attachments: [],
  createdAt: "2026-10-31T10:00:00.000Z",
  ...overrides,
});

describe("formatDay", () => {
  const now = new Date(2026, 9, 31, 15, 0);

  it("dit « Aujourd'hui » et « Hier »", () => {
    expect(formatDay(new Date(2026, 9, 31, 8, 0).toISOString(), "fr", strings, now)).toBe("Aujourd'hui");
    expect(formatDay(new Date(2026, 9, 30, 23, 0).toISOString(), "fr", strings, now)).toBe("Hier");
  });

  it("donne la date complète au-delà", () => {
    expect(formatDay(new Date(2026, 9, 20, 9, 0).toISOString(), "fr", strings, now)).toBe("mardi 20 octobre");
  });
});

describe("continuesPrevious", () => {
  const first = message({});

  it("regroupe deux messages du même auteur à moins de 5 minutes", () => {
    expect(continuesPrevious(first, message({ createdAt: "2026-10-31T10:03:00.000Z" }))).toBe(true);
  });

  it("sépare au-delà de 5 minutes, pour un autre auteur ou pour une réponse", () => {
    expect(continuesPrevious(first, message({ createdAt: "2026-10-31T10:06:00.000Z" }))).toBe(false);
    expect(
      continuesPrevious(first, message({ author: { kind: "member", userId: "u2", displayName: "Awa" } })),
    ).toBe(false);
    expect(
      continuesPrevious(
        first,
        message({ replyTo: { id: first.id, author: first.author, excerpt: "texte" } }),
      ),
    ).toBe(false);
  });
});

describe("authorName", () => {
  const withYou = { ...strings, you: "{0} (Vous)" } as ChatStrings;
  const author = { kind: "member", userId: "u1", displayName: "Doms" } as const;

  it("ajoute « (Vous) » à ses propres messages", () => {
    expect(authorName(author, withYou, "u1")).toBe("Doms (Vous)");
    expect(authorName(author, withYou, "u2")).toBe("Doms");
  });
});

describe("formatSize", () => {
  it("choisit l'unité et garde une décimale sous 10", () => {
    expect(formatSize(850, "fr")).toBe("850 o");
    expect(formatSize(1229, "fr")).toBe("1,2 Ko");
    expect(formatSize(14 * 1024 * 1024, "fr")).toBe("14 Mo");
  });
});
