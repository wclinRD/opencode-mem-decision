export class ExtractionService {
  constructor(config = {}) {
    this.config = config;
  }

  async extract(text) {
    const provider = this.config.extractionProvider || "stub";
    if (this.config.extractionApiUrl) {
      return this._extractRemote(text, this.config.extractionModel || "gpt-4o-mini", this.config.extractionApiUrl, this.config.extractionApiKey);
    }
    if (provider === "huggingface") {
      return this._extractHf(text, this.config.extractionModel || "Qwen/Qwen2.5-Coder-1.5B-Instruct");
    }
    return this._extractStub(text);
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
    const topics = [...new Set(words.slice(0, 5))];
    return {
      summary: text.slice(0, 200) + (text.length > 200 ? "..." : ""),
      topics,
      codeSnippets: text.match(/`[^`]+`/g)?.slice(0, 3) || [],
      decisions: [],
    };
  }
}
