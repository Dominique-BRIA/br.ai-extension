# Journal des versions

## 0.6.3

- Mémoire : une rubrique Connaissances rassemble ce que l'IA a appris sur le web, avec ses sources.

## 0.6.2

- Sous le message où le cuisinier prend une commande, « Détails » montre ce qu'il est en train de faire.
- Un onglet Fichiers rassemble ce que le cuisinier a créé et ce qui a été envoyé dans le chat ; le contenu d'un .zip s'y parcourt fichier par fichier.

## 0.6.1

- L'inscription est ouverte à tous, sans code d'invitation.
- Le code d'invitation donne des crédits d'IA à l'équipe : le chef le saisit dans l'onglet Équipe.
- « Demander une suite » continue une commande au lieu d'en créer une nouvelle ; le serveur reconnaît aussi les suites demandées dans le chat.
- Le cuisinier vérifie son travail avant de terminer, et le bilan signale ce qui n'a pas pu l'être.
- Le terminal du cuisinier ne se rouvre plus tout seul quand vous l'avez fermé.
- Une commande non sensible peut s'exécuter sur la machine cloud de <br/>, sans machine allumée chez un membre : chaque projet y a son espace, et le résultat arrive en .zip à télécharger.
- Un bouton « Nouvelle commande » dans l'onglet Commandes : un titre, ce que le cuisinier doit faire, et la commande part, sans passer par @bria.
- Envoi immédiat : la zone de saisie se vide aussitôt, le message s'affiche avec une horloge puis une coche une fois enregistré, ou « Non envoyé » avec Réessayer. Le bouton d'envoi tourne pendant l'envoi.
- Nouvelles couleurs des messages : bleu ardoise pour les vôtres, gris anthracite pour ceux des collègues, vert émeraude très sombre pour les IA.

## 0.6.0

- Un projet peut être branché à un dépôt GitHub : le chef le choisit, chaque membre peut le cloner en un clic.
- Chaque commande du cuisinier travaille sur sa propre branche, enregistre un commit au nom du membre, puis pousse la branche tout de suite ou après accord (réglage « bria.pushMode »).
- Le travail non enregistré d'un membre n'est jamais touché : la commande s'arrête plutôt.
- Le demandeur valide une commande : une pull request est ouverte et fusionnée avec son compte GitHub. Si GitHub refuse la fusion, elle reste ouverte et la raison s'affiche.
- Après une fusion, les autres membres sont prévenus qu'une nouvelle version est disponible. S'ils acceptent, le dossier se met à jour et les nouvelles dépendances s'installent dans un terminal. Le travail non enregistré n'est jamais écrasé : le membre choisit quoi en faire.
- Une commande en cours peut passer à une autre machine : le cuisinier pousse son travail et laisse une note de reprise, puis la machine suivante vérifie son environnement et continue.
- Application GitHub facultative, proposée au chef quand il branche un dépôt : le serveur fusionne sans machine allumée et il est prévenu des fusions faites sur GitHub.

## 0.5.1

- Le bouton \<br/\> reste visible en haut à droite de l'éditeur, même sans être connecté.

## 0.5.0

Première version publiée, pour la bêta privée sur invitation.

- Chat d'équipe par projet, en temps réel, avec réponses, mentions et notifications.
- Le serveur : mémoire du projet, résumé d'absence, réponses à la demande.
- Le cuisinier : commandes réalisées sur la machine d'un membre, avec modes de permission et terminal dédié.
- Coffre de secrets du projet et mémoire locale des préférences.
- Interface en français et en anglais.
