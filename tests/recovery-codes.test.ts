import { describe, expect, it } from "vitest";

import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/data/auth";

describe("recovery codes", () => {
  it("generates unique, formatted codes", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });

  it("normalizes input tolerating spaces, dashes, and case", () => {
    expect(normalizeRecoveryCode(" b7k2-m3p9 ")).toBe("B7K2-M3P9");
    expect(normalizeRecoveryCode("abcd-EFGH")).toBe("ABCD-EFGH");
    expect(normalizeRecoveryCode("abcdEFGH")).toBe("ABCD-EFGH");
    expect(normalizeRecoveryCode("ABCD- EFGH")).toBe("ABCD-EFGH");
  });

  it("hashes codes in a single-use fashion", async () => {
    const codes = generateRecoveryCodes(1);
    const code = codes[0] as string;
    const hash = hashRecoveryCode(code);
    const sameAgain = hashRecoveryCode(normalizeRecoveryCode(code));
    expect(hash).toBe(sameAgain);
    expect(hash).not.toContain(code.replace("-", ""));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});