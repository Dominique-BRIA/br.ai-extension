import { describe, expect, it } from "vitest";
import { reconnectDelay } from "../src/backoff";

describe("reconnectDelay", () => {
  const sansAleatoire = () => 0.5;

  it("double le délai à chaque tentative", () => {
    expect(reconnectDelay(0, sansAleatoire)).toBe(1_000);
    expect(reconnectDelay(1, sansAleatoire)).toBe(2_000);
    expect(reconnectDelay(3, sansAleatoire)).toBe(8_000);
  });

  it("plafonne le délai à 30 secondes", () => {
    expect(reconnectDelay(20, sansAleatoire)).toBe(30_000);
  });

  it("varie de plus ou moins 20 %", () => {
    expect(reconnectDelay(2, () => 0)).toBe(3_200);
    expect(reconnectDelay(2, () => 1)).toBe(4_800);
  });
});
