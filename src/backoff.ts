/**
 * Délai avant la prochaine tentative de reconnexion : 1 s, 2 s, 4 s… plafonné à 30 s,
 * avec une part d'aléatoire pour que toutes les machines ne se reconnectent pas en même temps.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}
