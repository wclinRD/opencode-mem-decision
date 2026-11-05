import test from "node:test";
import assert from "node:assert/strict";
import { ExtractionService } from "../src/extraction.js";

// Mock generateFn that simulates LLM response
function mockGenerateFn(response) {
  return async (sessionID, prompt) => {
    return response;
  };
}

test("extraction with generateFn parses JSON response", async () => {
  const mockResponse = JSON.stringify({
    summary: "Discussed architecture for memory plugin",
    topics: ["memory", "architecture", "sqlite"],
    codeSnippets: ["const db = open('mem.db')"],
    decisions: ["Use SQLite for storage", "Implement hybrid retrieval"],
    facts: ["Plugin uses V2 API", "Embeddings via OpenAI"],
    lessons: ["Always test edge cases"]
  });

  const service = new ExtractionService({
    generateFn: mockGenerateFn(mockResponse)
  });

  const result = await service.extract("Some session text");

  assert.equal(result.summary, "Discussed architecture for memory plugin");
  assert.deepEqual(result.topics, ["memory", "architecture", "sqlite"]);
  assert.deepEqual(result.decisions, ["Use SQLite for storage", "Implement hybrid retrieval"]);
  assert.deepEqual(result.facts, ["Plugin uses V2 API", "Embeddings via OpenAI"]);
  assert.deepEqual(result.lessons, ["Always test edge cases"]);
  assert.deepEqual(result.codeSnippets, ["const db = open('mem.db')"]);
});

test("extraction with generateFn handles JSON in code fences", async () => {
  const mockResponse = "```json\n{\"summary\": \"Test\", \"topics\": [], \"codeSnippets\": [], \"decisions\": [], \"facts\": [], \"lessons\": []}\n```";

  const service = new ExtractionService({
    generateFn: mockGenerateFn(mockResponse)
  });

  const result = await service.extract("Some session text");

  assert.equal(result.summary, "Test");
});

test("extraction with generateFn falls back to summary on invalid JSON", async () => {
  const service = new ExtractionService({
    generateFn: mockGenerateFn("This is not JSON, just plain text summary")
  });

  const result = await service.extract("Some session text");

  assert.equal(result.summary, "This is not JSON, just plain text summary");
  assert.deepEqual(result.topics, []);
  assert.deepEqual(result.decisions, []);
});

test("extraction with generateFn handles empty response", async () => {
  const service = new ExtractionService({
    generateFn: mockGenerateFn("")
  });

  const result = await service.extract("Some session text");

  assert.equal(result.summary, "");
});

test("extraction with stub provider", async () => {
  const service = new ExtractionService({
    extractionProvider: "stub"
  });

  const result = await service.extract("This project uses TypeScript and React with Node.js for the backend. We decided to use SQLite for storage. The API uses JWT tokens.");

  assert.ok(result !== null);
  assert.ok(typeof result.summary === "string");
  assert.ok(result.summary.length > 0);
  assert.ok(Array.isArray(result.topics));
  assert.ok(Array.isArray(result.decisions));
});

test("extraction with stub returns null for non-technical text", async () => {
  const service = new ExtractionService({
    extractionProvider: "stub"
  });

  const result = await service.extract("hello world");

  assert.equal(result, null);
});

test("extraction with generateFn takes precedence over remote config", async () => {
  let generateFnCalled = false;
  const service = new ExtractionService({
    generateFn: mockGenerateFn(JSON.stringify({ summary: "From generateFn", topics: [], codeSnippets: [], decisions: [], facts: [], lessons: [] })),
    extractionApiUrl: "http://fake-url",
    extractionApiKey: "fake-key",
    generateFnWrapper: (fn) => async (sessionID, prompt) => {
      generateFnCalled = true;
      return fn(sessionID, prompt);
    }
  });

  const result = await service.extract("Some text");

  assert.equal(result.summary, "From generateFn");
});

test("extraction filters out empty items", async () => {
  const mockResponse = JSON.stringify({
    summary: "Summary here",
    topics: ["topic1", "", "topic2"],
    decisions: ["dec1", "  ", "dec2"],
    facts: [],
    lessons: []
  });

  const service = new ExtractionService({
    generateFn: mockGenerateFn(mockResponse)
  });

  const result = await service.extract("Some session text");

  assert.deepEqual(result.topics, ["topic1", "topic2"]);
  assert.deepEqual(result.decisions, ["dec1", "dec2"]);
  assert.deepEqual(result.facts, []);
});

// Test discrete memory creation from extraction results
test("discrete memories created from extraction results", async () => {
  const { autoCapture } = await import("../src/capture.js");

  // Mock storage
  const addedMemories = [];
  const mockStorage = {
    addMemory: async (content, scope, sessionID, metadata, duplicateConfig) => {
      const id = `mem_${addedMemories.length}`;
      addedMemories.push({ id, content, scope, sessionID, metadata });
      return { id, content, scope, sessionID, metadata };
    },
    listMemories: async () => addedMemories,
    searchMemories: async () => []
  };

  // Mock extraction service
  const mockExtraction = {
    extract: async (text, sessionID) => ({
      summary: "This session discussed the architecture of a memory plugin built in TypeScript using React and Node.js. Key topics included SQLite storage and hybrid retrieval.",
      topics: ["memory", "architecture", "sqlite"],
      codeSnippets: ["const db = open('mem.db')"],
      decisions: ["Use SQLite for all persistent storage", "Implement hybrid retrieval with keyword and semantic search"],
      facts: ["Plugin uses V2 API for integration", "Embeddings are generated via OpenAI service"],
      lessons: ["Always test edge cases thoroughly before deploying"]
    })
  };

  const mockClassify = () => ({ type: "general", confidence: 0.8, priority: 1, tags: [] });

  const result = await autoCapture({
    sessionData: {
      id: "test-session",
      messages: [{ content: "This is a long enough session text that should pass the quality threshold. We discussed architecture and made several important decisions about the implementation approach." }]
    },
    memoryConfig: {
      chatMessage: { enabled: true },
      duplicateDetection: { enabled: false }
    },
    storage: mockStorage,
    classifyMemory: mockClassify,
    extractionService: mockExtraction,
    extractionSessionID: "test-session"
  });

  assert.ok(result.action === "add", `Expected add, got ${result.action}`);
  assert.ok(result.discrete, "Expected discrete memories");

  // Expect: 1 summary + 2 decisions + 2 facts + 1 lesson + 1 code = 7 discrete memories
  const summaryMem = addedMemories.find(m => m.metadata.type === "summary");
  const decisionMems = addedMemories.filter(m => m.metadata.type === "decision");
  const factMems = addedMemories.filter(m => m.metadata.type === "fact");
  const lessonMems = addedMemories.filter(m => m.metadata.type === "lesson");
  const codeMems = addedMemories.filter(m => m.metadata.type === "code");

  assert.ok(summaryMem, "Expected summary memory");
  assert.equal(decisionMems.length, 2, "Expected 2 decision memories");
  assert.equal(factMems.length, 2, "Expected 2 fact memories");
  assert.equal(lessonMems.length, 1, "Expected 1 lesson memory");
  assert.ok(codeMems.length > 0, "Expected code memories");

  // Verify decision memories are discrete (each has one decision)
  assert.ok(decisionMems[0].content.includes("SQLite"));
  assert.ok(decisionMems[1].content.includes("hybrid"));

  // All should have auto-extraction tag
  for (const m of addedMemories) {
    assert.ok(m.metadata.tags.includes("auto-extraction"), `Expected auto-extraction tag on ${m.metadata.type}`);
  }
});

test("legacy fallback when extraction returns null", async () => {
  const { autoCapture } = await import("../src/capture.js");

  const addedMemories = [];
  const mockStorage = {
    addMemory: async (content, scope, sessionID, metadata, duplicateConfig) => {
      const id = `mem_${addedMemories.length}`;
      addedMemories.push({ id, content, scope, sessionID, metadata });
      return { id, content, scope, sessionID, metadata };
    },
    listMemories: async () => addedMemories,
    searchMemories: async () => []
  };

  const mockExtraction = {
    extract: async (text, sessionID) => null
  };

  const mockClassify = () => ({ type: "general", confidence: 0.8, priority: 1, tags: [] });

  const result = await autoCapture({
    sessionData: {
      id: "test-session",
      messages: [{ content: "This is a long enough session text that should pass the quality threshold. We discussed architecture and made several important decisions about the implementation approach." }]
    },
    memoryConfig: {
      chatMessage: { enabled: true },
      duplicateDetection: { enabled: false }
    },
    storage: mockStorage,
    classifyMemory: mockClassify,
    extractionService: mockExtraction
  });

  // Should fall back to legacy single memory
  assert.ok(result.action === "add");
  // At least 1 memory (the main one); summarizeRecentEvents may add another
  assert.ok(addedMemories.length >= 1, "Expected at least 1 memory");
  // First memory should be the legacy one (not discrete extraction)
  assert.ok(addedMemories[0].metadata.tags && !addedMemories[0].metadata.tags.includes("auto-extraction"));
});
