import { DANGEROUS_PATTERNS, INPUT_LIMITS } from "../constants/security.js";
import { logger } from "./logger.js";

/**
 * Result of sanitization check
 */
export interface SanitizationResult {
  /** Whether the input is safe */
  isSafe: boolean;
  /** Original input */
  original: string;
  /** Sanitized version (if sanitization was applied) */
  sanitized: string;
  /** Detected threats */
  threats: DetectedThreat[];
  /** Whether the input was truncated due to size */
  wasTruncated: boolean;
}

/**
 * A detected threat in the input
 */
export interface DetectedThreat {
  /** Type of threat detected */
  type: ThreatType;
  /** The matched pattern */
  match: string;
  /** Position in the input */
  position: number;
  /** Description of the threat */
  description: string;
}

/**
 * Types of threats that can be detected
 */
export type ThreatType =
  | "instruction_override"
  | "role_manipulation"
  | "instruction_injection"
  | "prompt_extraction"
  | "credential_extraction"
  | "code_execution"
  | "delimiter_manipulation"
  | "size_limit_exceeded";

/**
 * Options for sanitization
 */
export interface SanitizeOptions {
  /** Maximum allowed length (uses default if not provided) */
  maxLength?: number;
  /** Whether to remove threats or just detect them */
  mode?: "detect" | "sanitize";
  /** Whether to log detected threats */
  logThreats?: boolean;
}

/**
 * Map patterns to threat types for better categorization
 */
const PATTERN_THREAT_TYPES: Array<{ pattern: RegExp; type: ThreatType; description: string }> = [
  // Instruction override attempts
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi,
    type: "instruction_override",
    description: "Attempt to ignore previous instructions",
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above)/gi,
    type: "instruction_override",
    description: "Attempt to disregard previous context",
  },
  {
    pattern: /forget\s+(all\s+)?(previous|prior|above)/gi,
    type: "instruction_override",
    description: "Attempt to forget previous context",
  },
  {
    pattern: /override\s+(all\s+)?(previous|prior|above)/gi,
    type: "instruction_override",
    description: "Attempt to override previous instructions",
  },

  // Role manipulation
  {
    pattern: /you\s+are\s+now\s+/gi,
    type: "role_manipulation",
    description: "Attempt to change AI role",
  },
  {
    pattern: /pretend\s+(to\s+be|you\s+are)/gi,
    type: "role_manipulation",
    description: "Attempt to make AI pretend to be something else",
  },
  {
    pattern: /act\s+as\s+(if\s+you\s+are|a)/gi,
    type: "role_manipulation",
    description: "Attempt to make AI act as something else",
  },
  {
    pattern: /roleplay\s+as/gi,
    type: "role_manipulation",
    description: "Roleplay injection attempt",
  },

  // New instruction injection
  {
    pattern: /new\s+instructions?:/gi,
    type: "instruction_injection",
    description: "Attempt to inject new instructions",
  },
  {
    pattern: /updated\s+instructions?:/gi,
    type: "instruction_injection",
    description: "Attempt to inject updated instructions",
  },
  {
    pattern: /revised\s+instructions?:/gi,
    type: "instruction_injection",
    description: "Attempt to inject revised instructions",
  },
  {
    pattern: /actual\s+instructions?:/gi,
    type: "instruction_injection",
    description: "Attempt to inject 'actual' instructions",
  },

  // System prompt extraction
  {
    pattern: /system\s*prompt/gi,
    type: "prompt_extraction",
    description: "Attempt to reference system prompt",
  },
  {
    pattern: /reveal\s+(your|the)\s+(instructions|prompt|system)/gi,
    type: "prompt_extraction",
    description: "Attempt to extract instructions",
  },
  {
    pattern: /show\s+(me\s+)?(your|the)\s+(instructions|prompt)/gi,
    type: "prompt_extraction",
    description: "Attempt to view instructions",
  },
  {
    pattern: /what\s+(are|is)\s+your\s+(instructions|prompt|system)/gi,
    type: "prompt_extraction",
    description: "Attempt to query system instructions",
  },

  // API key extraction
  {
    pattern: /api[_\s-]?key/gi,
    type: "credential_extraction",
    description: "Possible API key extraction attempt",
  },
  {
    pattern: /secret[_\s-]?key/gi,
    type: "credential_extraction",
    description: "Possible secret key extraction attempt",
  },
  {
    pattern: /access[_\s-]?token/gi,
    type: "credential_extraction",
    description: "Possible access token extraction attempt",
  },

  // Code execution attempts
  {
    pattern: /exec\s*\(/gi,
    type: "code_execution",
    description: "Possible exec() injection",
  },
  {
    pattern: /eval\s*\(/gi,
    type: "code_execution",
    description: "Possible eval() injection",
  },
  {
    pattern: /system\s*\(/gi,
    type: "code_execution",
    description: "Possible system() injection",
  },
  {
    pattern: /subprocess/gi,
    type: "code_execution",
    description: "Possible subprocess reference",
  },
  {
    pattern: /child_process/gi,
    type: "code_execution",
    description: "Possible child_process reference",
  },

  // Delimiter manipulation
  {
    pattern: /```\s*system/gi,
    type: "delimiter_manipulation",
    description: "Attempt to use system code block",
  },
  {
    pattern: /<\/?system>/gi,
    type: "delimiter_manipulation",
    description: "Attempt to use system XML tags",
  },
  {
    pattern: /\[INST\]/gi,
    type: "delimiter_manipulation",
    description: "Attempt to use instruction delimiters",
  },
  {
    pattern: /\[\/INST\]/gi,
    type: "delimiter_manipulation",
    description: "Attempt to close instruction block",
  },
];

/**
 * Sanitize input text for prompt injection attempts
 *
 * @param input - The input text to sanitize
 * @param options - Sanitization options
 * @returns Sanitization result with detected threats
 */
export function sanitizeInput(
  input: string,
  options: SanitizeOptions = {}
): SanitizationResult {
  const { maxLength = INPUT_LIMITS.TASK_MAX_LENGTH, mode = "detect", logThreats = true } = options;

  const threats: DetectedThreat[] = [];
  let sanitized = input;
  let wasTruncated = false;

  // Check size limit
  if (input.length > maxLength) {
    threats.push({
      type: "size_limit_exceeded",
      match: `Input length: ${input.length}`,
      position: maxLength,
      description: `Input exceeds maximum length of ${maxLength} characters`,
    });
    sanitized = sanitized.slice(0, maxLength);
    wasTruncated = true;
  }

  // Check all patterns
  for (const { pattern, type, description } of PATTERN_THREAT_TYPES) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(input)) !== null) {
      threats.push({
        type,
        match: match[0],
        position: match.index,
        description,
      });

      // In sanitize mode, remove the matched content
      if (mode === "sanitize") {
        sanitized = sanitized.replace(match[0], "[REDACTED]");
      }
    }
  }

  const isSafe = threats.length === 0;

  // Log threats if detected and logging is enabled
  if (!isSafe && logThreats) {
    logger.warn(
      {
        threatCount: threats.length,
        threatTypes: [...new Set(threats.map((t) => t.type))],
        inputLength: input.length,
        inputPreview: input.slice(0, 100),
      },
      "Potential prompt injection detected"
    );
  }

  return {
    isSafe,
    original: input,
    sanitized,
    threats,
    wasTruncated,
  };
}

/**
 * Sanitize a task input specifically
 *
 * @param task - The task description to sanitize
 * @param options - Additional options
 * @returns Sanitization result
 */
export function sanitizeTask(
  task: string,
  options: Omit<SanitizeOptions, "maxLength"> = {}
): SanitizationResult {
  return sanitizeInput(task, {
    ...options,
    maxLength: INPUT_LIMITS.TASK_MAX_LENGTH,
  });
}

/**
 * Sanitize a criterion input specifically
 *
 * @param criterion - The criterion to sanitize
 * @param options - Additional options
 * @returns Sanitization result
 */
export function sanitizeCriterion(
  criterion: string,
  options: Omit<SanitizeOptions, "maxLength"> = {}
): SanitizationResult {
  return sanitizeInput(criterion, {
    ...options,
    maxLength: INPUT_LIMITS.CRITERION_MAX_LENGTH,
  });
}

/**
 * Sanitize multiple criteria
 *
 * @param criteria - Array of criteria to sanitize
 * @param options - Additional options
 * @returns Array of sanitization results and aggregate safety status
 */
export function sanitizeCriteria(
  criteria: string[],
  options: Omit<SanitizeOptions, "maxLength"> = {}
): { results: SanitizationResult[]; allSafe: boolean; totalThreats: number } {
  // Check criteria count limit
  if (criteria.length > INPUT_LIMITS.CRITERIA_MAX_COUNT) {
    logger.warn(
      {
        criteriaCount: criteria.length,
        maxAllowed: INPUT_LIMITS.CRITERIA_MAX_COUNT,
      },
      "Criteria count exceeds maximum"
    );
  }

  const results = criteria
    .slice(0, INPUT_LIMITS.CRITERIA_MAX_COUNT)
    .map((c) => sanitizeCriterion(c, options));

  const allSafe = results.every((r) => r.isSafe);
  const totalThreats = results.reduce((sum, r) => sum + r.threats.length, 0);

  return { results, allSafe, totalThreats };
}

/**
 * Quick check if input contains any dangerous patterns
 * More efficient than full sanitization when you just need a boolean result
 *
 * @param input - The input to check
 * @returns True if the input appears safe
 */
export function isInputSafe(input: string): boolean {
  for (const pattern of DANGEROUS_PATTERNS) {
    // Reset lastIndex for global patterns
    const p = new RegExp(pattern.source, pattern.flags);
    if (p.test(input)) {
      return false;
    }
  }
  return true;
}

/**
 * Get a summary of threats for logging or display
 *
 * @param threats - Array of detected threats
 * @returns Human-readable summary
 */
export function getThreatSummary(threats: DetectedThreat[]): string {
  if (threats.length === 0) {
    return "No threats detected";
  }

  const byType = threats.reduce(
    (acc, t) => {
      acc[t.type] = (acc[t.type] || 0) + 1;
      return acc;
    },
    {} as Record<ThreatType, number>
  );

  const parts = Object.entries(byType).map(
    ([type, count]) => `${type}: ${count}`
  );

  return `Detected ${threats.length} threat(s): ${parts.join(", ")}`;
}
