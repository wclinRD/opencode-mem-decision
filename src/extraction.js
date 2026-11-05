const TECHNICAL_KEYWORDS = new Set([
  "typescript", "javascript", "python", "go", "rust", "react", "node", "docker",
  "kubernetes", "aws", "database", "config", "api", "server", "frontend", "backend",
  "authentication", "authorization", "cache", "deployment", "pipeline", "test",
  "unit test", "integration", "debug", "log", "performance", "security", "refactor",
  "architecture", "migration", "schema", "query", "index", "build", "deploy",
]);

export class ExtractionService {
  constructor(config = {}) {
    this.config = config;
    this.generateFn = config.generateFn || null;
  }

  async extract(text, sessionID = null) {
    // Use the session LLM (generateFn) when available — highest quality.
    if (this.generateFn) {
      try {
        return await this._extractWithGenerateFn(text, sessionID);
      } catch (e) {
        console.error(`[opencode-mem-decision] generateFn extraction failed: ${e.message}`);
        // Fall through to fallback extraction
      }
    }
    const provider = this.config.extractionProvider || "stub";
    if (this.config.extractionApiUrl) {
      return this._extractRemote(text, this.config.extractionModel || "gpt-4o-mini", this.config.extractionApiUrl, this.config.extractionApiKey);
    }
    if (provider === "huggingface") {
      return this._extractHf(text, this.config.extractionModel || "Qwen/Qwen2.5-Coder-1.5B-Instruct");
    }
    return this._extractStub(text);
  }

  async _extractWithGenerateFn(text, sessionID) {
    const prompt =
      "Extract memorable information from this session. Return a JSON object with keys: summary (string), topics (array of strings), codeSnippets (array of strings), decisions (array of strings), facts (array of strings), lessons (array of strings). Each item should be a discrete, actionable memory. Do not include filler or generic content.\n\nSession:\n" + text;
    const response = await this.generateFn(sessionID, prompt);
    const content = typeof response === "string" ? response : response?.text || "";
    return this._parseExtractionJson(content);
  }

  _parseExtractionJson(content) {
    try {
      // Handle markdown code fences
      let cleaned = content.trim();
      if (cleaned.startsWith("```")) {
        const lines = cleaned.split("\n");
        if (lines[lines.length - 1].trim() === "```") {
          cleaned = lines.slice(1, -1).join("\n").trim();
        } else {
          cleaned = lines.slice(1).join("\n").trim();
        }
      }
      const parsed = JSON.parse(cleaned);
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
        topics: Array.isArray(parsed.topics) ? parsed.topics.filter((t) => typeof t === "string" && t.trim()) : [],
        codeSnippets: Array.isArray(parsed.codeSnippets) ? parsed.codeSnippets.filter((s) => typeof s === "string" && s.trim()) : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter((d) => typeof d === "string" && d.trim()) : [],
        facts: Array.isArray(parsed.facts) ? parsed.facts.filter((f) => typeof f === "string" && f.trim()) : [],
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons.filter((l) => typeof l === "string" && l.trim()) : [],
      };
    } catch {
      return {
        summary: content.trim(),
        topics: [],
        codeSnippets: [],
        decisions: [],
        facts: [],
        lessons: [],
      };
    }
  }

  async _extractRemote(text, model, apiBaseUrl, apiKey) {
    const url = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Extract structured information from the user's session. Return a JSON object with keys: summary, topics, codeSnippets, decisions.",
          },
          {
            role: "user",
            content: text,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`Extraction API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    const content = data.choices && data.choices[0] ? data.choices[0].message?.content : data;
    try {
      return JSON.parse(content);
    } catch {
      return { summary: content, topics: [], codeSnippets: [], decisions: [] };
    }
  }

  async _extractHf(text, model) {
    const hfToken = this.config.hfToken || process.env.HF_TOKEN;
    const url = `https://api-inference.huggingface.co/models/${model}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
      },
      body: JSON.stringify({
        inputs: `Extract structured information from the user's session. Return a JSON object with keys: summary, topics, codeSnippets, decisions.\n\nUser session: ${text}`,
        parameters: { max_new_tokens: 512 },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HuggingFace Inference error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (Array.isArray(data) && data[0] && data[0].generated_text) {
      const content = data[0].generated_text;
      try {
        return JSON.parse(content);
      } catch {
        return { summary: content, topics: [], codeSnippets: [], decisions: [] };
      }
    }
    return { summary: data?.generated_text || data, topics: [], codeSnippets: [], decisions: [] };
  }

  _extractStub(text) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const technicalWords = words.filter((w) => TECHNICAL_KEYWORDS.has(w) || /[a-z]+/.test(w) && /[0-9]+/.test(w));
    if (technicalWords.length < 3) {
      return null; // No meaningful technical content to extract
    }
    const topics = [...new Set(technicalWords.slice(0, 5))].filter((t) => t.length > 3);
    const codeSnippets = text.match(/`[^`]+`/g)?.slice(0, 3) || [];
    const decisions = [];
    // Look for decision-like patterns: "decide", "use", "prefer", "avoid", "must", "change"
    const decisionMatches = text.match(/(?:decide|use|prefer|avoid|must|should|change|adopt|remove|keep|use|try)\b.+/gi) || [];
    for (const d of decisionMatches) {
      if (d.length > 20) decisions.push(d.trim());
    }
    return {
      summary: text.slice(0, 200) + (text.length > 200 ? "..." : ""),
      topics,
      codeSnippets,
      decisions,
      facts: decisions,
      lessons: [],
    };
  }
}
