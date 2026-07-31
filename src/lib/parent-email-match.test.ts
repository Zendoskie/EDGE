import { describe, expect, it } from "vitest";
import {
  hasParentEmail,
  normalizeEmailForCompare,
  parentEmailsMatch,
} from "@/lib/parent-email-match";

describe("normalizeEmailForCompare", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEmailForCompare("  Parent@Gmail.com  ")).toBe("parent@gmail.com");
  });

  it("lowercases the address", () => {
    expect(normalizeEmailForCompare("PARENT@GMAIL.COM")).toBe("parent@gmail.com");
  });

  it("returns an empty string for null/undefined/empty", () => {
    expect(normalizeEmailForCompare(null)).toBe("");
    expect(normalizeEmailForCompare(undefined)).toBe("");
    expect(normalizeEmailForCompare("   ")).toBe("");
  });
});

describe("parentEmailsMatch", () => {
  it("matches case-insensitively with different casing", () => {
    expect(parentEmailsMatch("Parent@Gmail.com", "parent@gmail.com")).toBe(true);
  });

  it("matches when both are identical after normalization", () => {
    expect(parentEmailsMatch("juan.dela.cruz@gmail.com", "juan.dela.cruz@gmail.com")).toBe(true);
  });

  it("does not match different addresses", () => {
    expect(parentEmailsMatch("parent1@gmail.com", "parent2@gmail.com")).toBe(false);
  });

  it("does not match when one side is missing", () => {
    expect(parentEmailsMatch(null, "parent@gmail.com")).toBe(false);
    expect(parentEmailsMatch("parent@gmail.com", undefined)).toBe(false);
  });
});

describe("hasParentEmail", () => {
  it("is true when a real email is present", () => {
    expect(hasParentEmail("parent@gmail.com")).toBe(true);
  });

  it("is false for missing or whitespace-only values", () => {
    expect(hasParentEmail(null)).toBe(false);
    expect(hasParentEmail(undefined)).toBe(false);
    expect(hasParentEmail("   ")).toBe(false);
    expect(hasParentEmail("")).toBe(false);
  });
});
