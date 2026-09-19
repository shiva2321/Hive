import fs from "fs";
import path from "path";
import { config } from "../config/env";

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  description: string;
  context_length: number;
  prompt_pricing: number; // USD per 1M tokens
  completion_pricing: number; // USD per 1M tokens
  provider: string;
  is_recommended?: boolean;
}

export interface OpenRouterKeyStatus {
  valid: boolean;
  label?: string;
  usage?: number;
  limit?: number | null;
  is_free_tier?: boolean;
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
}

export class OpenRouterClient {
  private static cachedModels: OpenRouterModelInfo[] | null = null;
  private static cacheTimestamp: number = 0;
  private static readonly CACHE_TTL_MS = 1000 * 60 * 30; // 30 mins

  private static readonly RECOMMENDED_MODEL_IDS = new Set([
    "google/gemini-2.5-flash",
    "google/gemini-3.7-flash",
    "google/gemini-2.5-pro",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.7-sonnet",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-r1",
    "meta-llama/llama-3.3-70b-instruct",
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "mistralai/mistral-large-2411",
    "qwen/qwen-2.5-72b-instruct"
  ]);

  /**
   * Retrieves active API key from runtime memory, .env, or passed key
   */
  public static getActiveKey(overrideKey?: string): string | null {
    if (overrideKey && overrideKey.trim().length > 0) return overrideKey.trim();
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0) {
      return process.env.OPENROUTER_API_KEY.trim();
    }
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(/^OPENROUTER_API_KEY=(.*)$/m);
      if (match && match[1]?.trim()) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Saves API key to local .env and process.env
   */
  public static saveKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    process.env.OPENROUTER_API_KEY = trimmed;

    const envPath = path.resolve(process.cwd(), ".env");
    let content = "";
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf-8");
    }

    if (/^OPENROUTER_API_KEY=.*$/m.test(content)) {
      content = content.replace(/^OPENROUTER_API_KEY=.*$/m, `OPENROUTER_API_KEY=${trimmed}`);
    } else {
      content = (content.trim() ? content.trim() + "\n" : "") + `OPENROUTER_API_KEY=${trimmed}\n`;
    }

    fs.writeFileSync(envPath, content, "utf-8");
  }

  /**
   * Verifies the given OpenRouter API key and fetches balance/quota
   */
  public static async verifyKey(apiKey?: string): Promise<OpenRouterKeyStatus> {
    const key = this.getActiveKey(apiKey);
    if (!key) {
      return { valid: false, error: "No API key configured" };
    }

    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: {
          Authorization: `Bearer ${key}`
        }
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { valid: false, error: `Invalid key (${res.status}): ${errorText}` };
      }

      const json = await res.json() as any;
      const data = json.data || json;
      return {
        valid: true,
        label: data.label || "Personal Key",
        usage: data.usage || 0,
        limit: data.limit !== undefined ? data.limit : null,
        is_free_tier: data.is_free_tier || false
      };
    } catch (err: any) {
      return { valid: false, error: `Network error verifying key: ${err.message}` };
    }
  }

  /**
   * Fetches models catalog from OpenRouter, with friendly pricing and search index
   */
  public static async listModels(apiKey?: string): Promise<OpenRouterModelInfo[]> {
    const now = Date.now();
    if (this.cachedModels && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cachedModels;
    }

    try {
      const headers: Record<string, string> = {};
      const key = this.getActiveKey(apiKey);
      if (key) {
        headers["Authorization"] = `Bearer ${key}`;
      }

      const res = await fetch("https://openrouter.ai/api/v1/models", { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch models from OpenRouter: ${res.statusText}`);
      }

      const json = await res.json() as any;
      const rawList = Array.isArray(json.data) ? json.data : [];

      const models: OpenRouterModelInfo[] = rawList.map((m: any) => {
        const promptPrice = parseFloat(m.pricing?.prompt || "0") * 1000000;
        const completionPrice = parseFloat(m.pricing?.completion || "0") * 1000000;
        const provider = m.id.split("/")[0] || "unknown";

        return {
          id: m.id,
          name: m.name || m.id,
          description: m.description || "",
          context_length: m.context_length || 4096,
          prompt_pricing: Math.round(promptPrice * 100) / 100,
          completion_pricing: Math.round(completionPrice * 100) / 100,
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          is_recommended: this.RECOMMENDED_MODEL_IDS.has(m.id)
        };
      });

      // Sort: Recommended first, then by context length descending
      models.sort((a, b) => {
        if (a.is_recommended && !b.is_recommended) return -1;
        if (!a.is_recommended && b.is_recommended) return 1;
        return b.context_length - a.context_length;
      });

      this.cachedModels = models;
      this.cacheTimestamp = now;
      return models;
    } catch (err: any) {
      console.error("OpenRouter listModels error:", err.message);
      if (this.cachedModels) return this.cachedModels;
      // Fallback essential list if offline
      return this.getFallbackModels();
    }
  }

  /**
   * Executes a Chat Completion request with exponential backoff for 429 rate limits
   */
  public static async chatCompletion(options: ChatCompletionOptions): Promise<string> {
    const key = this.getActiveKey(options.apiKey);
    if (!key) {
      throw new Error("OpenRouter API key is not configured. Please supply an API key.");
    }

    const payload: any = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature !== undefined ? options.temperature : 0.1
    };

    if (options.maxTokens) {
      payload.max_tokens = options.maxTokens;
    }

    if (options.jsonMode) {
      payload.response_format = { type: "json_object" };
    }

    let attempts = 0;
    const maxAttempts = 3;
    let delayMs = 1500;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "HTTP-Referer": "http://localhost:42424",
            "X-Title": "Hive AI Universal Memory",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000)
        });

        if (res.status === 429 || res.status === 503) {
          console.warn(`[OpenRouter] Rate limited (HTTP ${res.status}). Retrying in ${delayMs}ms (Attempt ${attempts}/${maxAttempts})...`);
          await new Promise(r => setTimeout(r, delayMs));
          delayMs *= 2;
          continue;
        }

        if (!res.ok) {
          const errBody = await res.text();
          const err = new Error(`OpenRouter Error (${res.status}): ${errBody}`);
          (err as any).statusCode = res.status;
          // Fatal client errors should never be retried
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw err;
          }
          throw err;
        }

        const data = await res.json() as any;
        const reply = data.choices?.[0]?.message?.content;
        if (!reply) {
          throw new Error("Empty response received from OpenRouter model completion.");
        }

        return reply;
      } catch (err: any) {
        // Do not retry fatal client errors like 401/402
        if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
          throw err;
        }
        if (attempts >= maxAttempts) {
          throw err;
        }
        await new Promise(r => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }

    throw new Error("Failed to complete request to OpenRouter after maximum retries.");
  }

  private static getFallbackModels(): OpenRouterModelInfo[] {
    return [
      {
        id: "google/gemini-2.5-flash",
        name: "Google: Gemini 2.5 Flash",
        description: "Google's ultra-fast model with massive context window and high analytical speed.",
        context_length: 1048576,
        prompt_pricing: 0.15,
        completion_pricing: 0.60,
        provider: "Google",
        is_recommended: true
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        name: "Anthropic: Claude 3.5 Sonnet",
        description: "State-of-the-art reasoning and coding intelligence with 200,000 token context.",
        context_length: 200000,
        prompt_pricing: 3.00,
        completion_pricing: 15.00,
        provider: "Anthropic",
        is_recommended: true
      },
      {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek: DeepSeek V3",
        description: "671B parameter Mixture-of-Experts model offering frontier reasoning at very low cost.",
        context_length: 64000,
        prompt_pricing: 0.14,
        completion_pricing: 0.28,
        provider: "Deepseek",
        is_recommended: true
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        name: "Meta: Llama 3.3 70B Instruct",
        description: "Leading open-weight 70B model with 128k context window.",
        context_length: 131072,
        prompt_pricing: 0.35,
        completion_pricing: 0.40,
        provider: "Meta-llama",
        is_recommended: true
      }
    ];
  }
}
