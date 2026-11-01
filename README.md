# \<br\>.ia — extension VS Code

L'extension \<br\>.ia : le chat d'équipe dans la barre latérale, et l'exécution du travail de l'agent cuisinier sur cette machine.

Elle fonctionne dans VS Code, Cursor et Windsurf (VS Code 1.95 ou plus).

## Démarrer en local

L'extension utilise le protocole partagé du dépôt backend, qui doit être cloné à côté :

```
br-ia/
├─ backend/     https://github.com/Dominique-BRIA/br.ai-backend
└─ extension/   ce dépôt
```

1. Démarrer le serveur (voir le README du backend).
2. Dans ce dossier :

   ```sh
   npm install
   npm run build
   ```

3. Ouvrir ce dossier dans VS Code et lancer **Lancer l'extension** (F5). Une nouvelle fenêtre s'ouvre avec <br>.ia dans la barre d'activité ; elle se connecte au serveur au démarrage.

L'adresse du serveur se règle avec le paramètre `bria.serverUrl` (par défaut `http://127.0.0.1:4000`).

En développement, le serveur accepte le code d'invitation `BETA-DEV` et écrit les codes de connexion dans son journal.

### Essayer à deux comptes sur la même machine

Une seconde fenêtre de test doit avoir son propre profil VS Code, sinon elle partage la session de la première :

```powershell
code --user-data-dir D:\Temp\bria-profil-2 --extensionDevelopmentPath D:\Dev\br-ia\extension
```


## Commandes

| Commande            | Rôle                                                     |
| ------------------- | -------------------------------------------------------- |
| `npm run build`     | Construit l'extension et la webview dans `dist/`         |
| `npm run watch`     | Reconstruit à chaque modification                        |
| `npm test`          | Tests                                                    |
| `npm run typecheck` | Vérification des types                                   |
| `npm run check`     | Vérification du style (Biome) ; `npm run format` corrige |
| `npm run package`   | Crée le fichier `.vsix` à installer                      |

## Organisation

| Dossier                      | Contenu                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `src/`                       | Code de l'extension : connexion au serveur, barre d'état, vue du chat |
| `webview/`                   | Interface du chat (React), aux couleurs du thème VS Code              |
| `l10n/`, `package.nls*.json` | Textes en anglais et en français                                      |
| `media/`                     | Icône de la barre d'activité                                          |
