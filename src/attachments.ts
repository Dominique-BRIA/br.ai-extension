import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE, type Attachment } from "@br-ia/protocol";
import * as vscode from "vscode";
import type { Api } from "./api";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Types que VS Code sait afficher lui-même ; les autres s'ouvrent avec l'application du système. */
const OPENS_IN_EDITOR = /^(image\/|text\/|application\/json$)/;

/** Choisit des fichiers, vérifie leur taille et les envoie au serveur. */
export async function pickAndUpload(
  api: Api,
  projectId: string,
  alreadyPending: number,
): Promise<Attachment[]> {
  const remaining = ATTACHMENTS_PER_MESSAGE - alreadyPending;
  if (remaining <= 0) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t("At most {0} attachments per message.", ATTACHMENTS_PER_MESSAGE),
    );
    return [];
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: vscode.l10n.t("Attach"),
    title: vscode.l10n.t("Attach files"),
  });
  if (!uris?.length) return [];

  const selected = uris.slice(0, remaining);
  const uploaded: Attachment[] = [];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: vscode.l10n.t("Sending attachments…") },
    async () => {
      for (const uri of selected) {
        const name = basename(uri.fsPath);
        const content = await readFile(uri.fsPath);
        if (content.length > ATTACHMENT_MAX_BYTES) {
          void vscode.window.showWarningMessage(
            vscode.l10n.t("{0} is larger than 20 MB and was not sent.", name),
          );
          continue;
        }
        const contentType = CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
        uploaded.push(await api.upload(projectId, name, contentType, content));
      }
    },
  );
  return uploaded;
}

/** Ouvre une pièce jointe (copie temporaire), ou l'enregistre à l'endroit choisi. */
export async function openAttachment(api: Api, attachment: Attachment, save: boolean): Promise<void> {
  let target: vscode.Uri | undefined;
  if (save) {
    target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? tmpdir(), attachment.name),
      ),
      saveLabel: vscode.l10n.t("Save"),
    });
    if (!target) return;
  } else {
    const folder = join(tmpdir(), "bria", attachment.id);
    await mkdir(folder, { recursive: true });
    target = vscode.Uri.file(join(folder, attachment.name));
  }

  const content = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: vscode.l10n.t("Downloading {0}…", attachment.name) },
    () => api.download(attachment.id),
  );
  await writeFile(target.fsPath, content);

  if (save) {
    void vscode.window.showInformationMessage(vscode.l10n.t("{0} saved.", attachment.name));
  } else if (OPENS_IN_EDITOR.test(attachment.contentType)) {
    await vscode.commands.executeCommand("vscode.open", target);
  } else {
    await vscode.env.openExternal(target);
  }
}
