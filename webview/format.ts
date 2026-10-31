import type { Message, MessageAuthor } from "@br-ia/protocol";
import type { ChatStrings } from "../src/webviewMessages";

/** Nom affiché de l'auteur ; ses propres messages portent la mention « (vous) ». */
export function authorName(author: MessageAuthor, strings: ChatStrings, myUserId?: string): string {
  switch (author.kind) {
    case "member":
      return author.userId === myUserId ? strings.you.replace("{0}", author.displayName) : author.displayName;
    case "former_member":
      return strings.formerMember;
    case "serveur":
      return strings.serveur;
    case "cuisinier":
      return strings.cuisinier;
  }
}

export function authorKey(author: MessageAuthor): string {
  return author.kind === "member" ? `member:${author.userId}` : author.kind;
}

export function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** « Aujourd'hui », « Hier » ou la date complète. */
export function formatDay(iso: string, locale: string, strings: ChatStrings, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return strings.today;
  if (days === 1) return strings.yesterday;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  }).format(date);
}

export function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** Un message suit le précédent s'il a le même auteur, le même jour, à moins de 5 minutes. */
export function continuesPrevious(previous: Message | undefined, message: Message): boolean {
  if (!previous || message.replyTo) return false;
  if (authorKey(previous.author) !== authorKey(message.author)) return false;
  if (!sameDay(previous.createdAt, message.createdAt)) return false;
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Taille lisible : « 850 o », « 1,2 Ko », « 14 Mo ». */
export function formatSize(bytes: number, locale: string): string {
  const units = ["o", "Ko", "Mo"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
