import test from "node:test";
import assert from "node:assert/strict";
import { redactCredentials } from "../src/security.js";

test("credential redaction - GitHub token", () => {
  const text = "My token is ghp_1234567890abcdefghijklmnopqrstuvwxyz";
  const result = redactCredentials(text);
  assert.ok(result.includes("[REDACTED:GitHub Token]"));
  assert.ok(!result.includes("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
});

test("credential redaction - OpenAI key", () => {
  const text = "OpenAI key: sk-abcdefghij1234567890ABCDEFGHIJ123456";
  const result = redactCredentials(text);
  assert.ok(result.includes("[REDACTED:OpenAI API Key]"));
  assert.ok(!result.includes("sk-abcdefghij1234567890ABCDEFGHIJ123456"));
});

test("credential redaction - AWS key", () => {
  const text = "AWS key: AKIAIOSFODNN7EXAMPLE";
  const result = redactCredentials(text);
  assert.ok(result.includes("[REDACTED:AWS Access Key]"));
  assert.ok(!result.includes("AKIAIOSFODNN7EXAMPLE"));
});

test("credential redaction - no credentials", () => {
  const text = "This is a normal text without any credentials.";
  const result = redactCredentials(text);
  assert.equal(result, text);
});
