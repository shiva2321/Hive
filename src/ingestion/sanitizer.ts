import { SanitizationResult } from "../core/types";

export class SecretSanitizer {
  // Regex rules for high-confidence secrets
  private static SECRET_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
    {
      name: "OpenAI API Key",
      regex: /sk-[a-zA-Z0-9]{20,T3BlbkFJ[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{32,}/g,
      replacement: "[REDACTED_OPENAI_KEY]"
    },
    {
      name: "Anthropic API Key",
      regex: /sk-ant-[a-zA-Z0-9_-]{32,}/g,
      replacement: "[REDACTED_ANTHROPIC_KEY]"
    },
    {
      name: "GitHub Token",
      regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,255}/g,
      replacement: "[REDACTED_GITHUB_TOKEN]"
    },
    {
      name: "AWS Access Key",
      regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
      replacement: "[REDACTED_AWS_KEY]"
    },
    {
      name: "Private SSH Key",
      regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
      replacement: "[REDACTED_PRIVATE_KEY]"
    },
    {
      name: "Database Connection URI",
      regex: /(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis):\/\/[a-zA-Z0-9_]+:[^@\s]+@[a-zA-Z0-9_.-]+(?::[0-9]+)?\/[a-zA-Z0-9_.-]*/g,
      replacement: "[REDACTED_DB_CONNECTION_STRING]"
    },
    {
      name: "Generic Bearer Token",
      regex: /Bearer\s+[a-zA-Z0-9_.\-~+/]+=*/gi,
      replacement: "Bearer [REDACTED_BEARER_TOKEN]"
    },
    {
      name: "JWT Token",
      regex: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
      replacement: "[REDACTED_JWT_TOKEN]"
    },
    {
      name: "Email Address",
      regex: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
      replacement: "[REDACTED_EMAIL]"
    }
  ];

  /**
   * Sanitizes arbitrary text by replacing all matched secrets and PII with safe tokens.
   */
  public static sanitize(text: string): SanitizationResult {
    if (!text) {
      return { cleanedText: "", redactedCount: 0, redactedTypes: [] };
    }

    let cleaned = text;
    let redactedCount = 0;
    const redactedTypes = new Set<string>();

    for (const pattern of this.SECRET_PATTERNS) {
      const matches = cleaned.match(pattern.regex);
      if (matches && matches.length > 0) {
        redactedCount += matches.length;
        redactedTypes.add(pattern.name);
        cleaned = cleaned.replace(pattern.regex, pattern.replacement);
      }
    }

    return {
      cleanedText: cleaned,
      redactedCount,
      redactedTypes: Array.from(redactedTypes)
    };
  }

  /**
   * Scans text for high entropy words (potential unformatted random secrets/passwords).
   */
  public static calculateShannonEntropy(str: string): number {
    if (!str || str.length === 0) return 0;
    const freqs: Record<string, number> = {};
    for (const char of str) {
      freqs[char] = (freqs[char] || 0) + 1;
    }
    let entropy = 0;
    const len = str.length;
    for (const char in freqs) {
      const p = freqs[char] / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }
}
