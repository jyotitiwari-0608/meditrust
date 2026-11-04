import { describe, it, expect, vi } from "vitest";

const mockGenerateJson = vi.fn();
const mockGenerateText = vi.fn();

vi.mock("../services/llmClient.js", () => ({
  generateJson: (...args) => mockGenerateJson(...args),
  generateText: (...args) => mockGenerateText(...args),
  PROVIDER: "gemini",
}));

import { extractSignal } from "../services/extraction.js";
import { justifyScore } from "../services/justification.js";

describe("extractSignal", () => {
  it("valid JSON with high confidence => needsReview false", async () => {
    mockGenerateJson.mockResolvedValue({
      manufacturer: "Cipla Ltd",
      drug: "amlodipine",
      batch: "B123",
      issueType: "NSQ",
      severity: "high",
      date: "2024-01-15",
      confidence: 0.9,
    });
    const out = await extractSignal("some signal text about Cipla Ltd and amlodipine", { signalId: "sig1" });
    expect(out.needsReview).toBe(false);
    expect(out.confidence).toBe(0.9);
    expect(out.json.manufacturer).toBe("Cipla Ltd");
  });

  it("invalid JSON => needsReview true", async () => {
    mockGenerateJson.mockRejectedValue(new Error("boom"));
    const out = await extractSignal("some signal text");
    expect(out.needsReview).toBe(true);
    expect(out.confidence).toBe(0);
  });

  it("confidence below 0.7 => needsReview true", async () => {
    mockGenerateJson.mockResolvedValue({ confidence: 0.4, manufacturer: null });
    const out = await extractSignal("some signal text");
    expect(out.needsReview).toBe(true);
  });

  it("hallucinated manufacturer not in text => needsReview true", async () => {
    mockGenerateJson.mockResolvedValue({
      manufacturer: "NonexistentCorp",
      drug: "amlodipine",
      confidence: 0.9,
    });
    const out = await extractSignal("some signal text about amlodipine only");
    expect(out.needsReview).toBe(true);
  });

  it("null key field => needsReview true", async () => {
    mockGenerateJson.mockResolvedValue({ manufacturer: null, drug: "amlodipine", confidence: 0.9 });
    const out = await extractSignal("some signal text about amlodipine");
    expect(out.needsReview).toBe(true);
  });
});

describe("justifyScore", () => {
  it("returns {text, source:'llm'} when all numbers present in input", async () => {
    mockGenerateText.mockResolvedValue(
      "This manufacturer scored 80 and is rated High."
    );
    const out = await justifyScore({ score: 80, band: "High", factors: [] });
    expect(out.source).toBe("llm");
    expect(out.text).toContain("80");
    expect(out.text).toContain("High");
  });

  it("falls back to template when a number not in input appears", async () => {
    mockGenerateText.mockResolvedValue(
      "This manufacturer scored 999 out of 100 and is rated High."
    );
    const out = await justifyScore({ score: 80, band: "High", factors: [] });
    expect(out.source).toBe("template");
    expect(out.text).not.toContain("999");
    expect(out.text).toContain("80");
  });

  it("falls back to template when LLM throws", async () => {
    mockGenerateText.mockRejectedValue(new Error("down"));
    const out = await justifyScore({ score: 50, band: "Low", factors: [] });
    expect(out.source).toBe("template");
    expect(out.text).toContain("50");
    expect(out.text).toContain("Low");
  });
});
