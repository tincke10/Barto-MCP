import { PII_PATTERNS } from "../constants/security.js";
import { logger } from "./logger.js";

/**
 * Types of PII that can be detected
 */
export type PIIType =
  | "email"
  | "phone_us"
  | "phone_intl"
  | "ssn"
  | "credit_card"
  | "api_key"
  | "ip_address"
  | "date_of_birth";

/**
 * A detected PII instance in the text
 */
export interface DetectedPII {
  /** Type of PII detected */
  type: PIIType;
  /** The matched value */
  value: string;
  /** Masked version of the value */
  masked: string;
  /** Start position in the text */
  startPosition: number;
  /** End position in the text */
  endPosition: number;
}

/**
 * Result of PII detection
 */
export interface PIIDetectionResult {
  /** Whether any PII was found */
  containsPII: boolean;
  /** Original text */
  original: string;
  /** Text with PII masked */
  masked: string;
  /** All detected PII instances */
  detections: DetectedPII[];
  /** Summary by PII type */
  summary: Record<PIIType, number>;
}

/**
 * Options for PII detection
 */
export interface PIIDetectionOptions {
  /** Which PII types to detect (defaults to all) */
  types?: PIIType[];
  /** Whether to mask detected PII in output */
  mask?: boolean;
  /** Custom masking character */
  maskChar?: string;
  /** Whether to log detections */
  logDetections?: boolean;
  /** Minimum confidence level (0-1, for future ML-based detection) */
  minConfidence?: number;
}

/**
 * Map PII pattern keys to types
 */
const PATTERN_TYPE_MAP: Record<keyof typeof PII_PATTERNS, PIIType> = {
  EMAIL: "email",
  PHONE_US: "phone_us",
  PHONE_INTL: "phone_intl",
  SSN: "ssn",
  CREDIT_CARD: "credit_card",
  API_KEY: "api_key",
  IP_ADDRESS: "ip_address",
  DATE_OF_BIRTH: "date_of_birth",
};

/**
 * Mask a PII value based on its type
 *
 * @param value - The value to mask
 * @param type - The type of PII
 * @param maskChar - Character to use for masking
 * @returns Masked value
 */
function maskValue(value: string, type: PIIType, maskChar: string = "*"): string {
  switch (type) {
    case "email": {
      // Show first char and domain: j***@example.com
      const [local, domain] = value.split("@");
      if (local && domain) {
        const maskedLocal = local[0] + maskChar.repeat(Math.min(local.length - 1, 5));
        return `${maskedLocal}@${domain}`;
      }
      return maskChar.repeat(value.length);
    }

    case "phone_us":
    case "phone_intl": {
      // Show last 4 digits: ***-***-1234
      const digits = value.replace(/\D/g, "");
      const last4 = digits.slice(-4);
      return maskChar.repeat(value.length - 4) + last4;
    }

    case "ssn": {
      // Show last 4 digits: ***-**-1234
      return `${maskChar}${maskChar}${maskChar}-${maskChar}${maskChar}-${value.slice(-4)}`;
    }

    case "credit_card": {
      // Show last 4 digits: ****-****-****-1234
      const digits = value.replace(/\D/g, "");
      const last4 = digits.slice(-4);
      return `${maskChar.repeat(4)}-${maskChar.repeat(4)}-${maskChar.repeat(4)}-${last4}`;
    }

    case "api_key": {
      // Show first 4 and last 4 chars: sk-a...xyz
      if (value.length > 12) {
        return `${value.slice(0, 4)}${maskChar.repeat(5)}${value.slice(-4)}`;
      }
      return maskChar.repeat(value.length);
    }

    case "ip_address": {
      // Partially mask: 192.168.***.***
      const parts = value.split(".");
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${maskChar.repeat(3)}.${maskChar.repeat(3)}`;
      }
      return maskChar.repeat(value.length);
    }

    case "date_of_birth": {
      // Mask completely but keep format: **/**/****
      return value.replace(/\d/g, maskChar);
    }

    default:
      return maskChar.repeat(value.length);
  }
}

/**
 * Detect PII in text
 *
 * @param text - The text to scan for PII
 * @param options - Detection options
 * @returns Detection result with all found PII
 */
export function detectPII(
  text: string,
  options: PIIDetectionOptions = {}
): PIIDetectionResult {
  const {
    types,
    mask = true,
    maskChar = "*",
    logDetections = true,
  } = options;

  const detections: DetectedPII[] = [];
  const summary: Record<PIIType, number> = {
    email: 0,
    phone_us: 0,
    phone_intl: 0,
    ssn: 0,
    credit_card: 0,
    api_key: 0,
    ip_address: 0,
    date_of_birth: 0,
  };

  // Check each pattern
  for (const [patternKey, pattern] of Object.entries(PII_PATTERNS)) {
    const piiType = PATTERN_TYPE_MAP[patternKey as keyof typeof PII_PATTERNS];

    // Skip if this type is not in the requested types
    if (types && !types.includes(piiType)) {
      continue;
    }

    // Reset the pattern's lastIndex for global patterns
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      const masked = maskValue(value, piiType, maskChar);

      detections.push({
        type: piiType,
        value,
        masked,
        startPosition: match.index,
        endPosition: match.index + value.length,
      });

      summary[piiType]++;
    }
  }

  // Sort detections by position (for proper masking)
  detections.sort((a, b) => a.startPosition - b.startPosition);

  // Create masked text
  let masked = text;
  if (mask && detections.length > 0) {
    // Replace in reverse order to maintain positions
    const reversedDetections = [...detections].reverse();
    for (const detection of reversedDetections) {
      masked =
        masked.slice(0, detection.startPosition) +
        detection.masked +
        masked.slice(detection.endPosition);
    }
  }

  const containsPII = detections.length > 0;

  // Log if PII was detected
  if (containsPII && logDetections) {
    const typesFound = Object.entries(summary)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${type}: ${count}`);

    logger.warn(
      {
        piiCount: detections.length,
        piiTypes: typesFound,
        textLength: text.length,
      },
      "PII detected in text"
    );
  }

  return {
    containsPII,
    original: text,
    masked,
    detections,
    summary,
  };
}

/**
 * Quick check if text contains any PII
 *
 * @param text - The text to check
 * @param types - Specific PII types to check for (defaults to all)
 * @returns True if PII is detected
 */
export function containsPII(text: string, types?: PIIType[]): boolean {
  for (const [patternKey, pattern] of Object.entries(PII_PATTERNS)) {
    const piiType = PATTERN_TYPE_MAP[patternKey as keyof typeof PII_PATTERNS];

    // Skip if this type is not in the requested types
    if (types && !types.includes(piiType)) {
      continue;
    }

    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Mask all PII in text and return only the masked version
 *
 * @param text - The text to mask
 * @param options - Masking options
 * @returns Masked text
 */
export function maskPII(
  text: string,
  options: Omit<PIIDetectionOptions, "mask"> = {}
): string {
  const result = detectPII(text, { ...options, mask: true });
  return result.masked;
}

/**
 * Get a summary string of PII detection results
 *
 * @param result - Detection result
 * @returns Human-readable summary
 */
export function getPIISummary(result: PIIDetectionResult): string {
  if (!result.containsPII) {
    return "No PII detected";
  }

  const typesFound = Object.entries(result.summary)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

  return `Detected ${result.detections.length} PII instance(s): ${typesFound}`;
}

/**
 * Validate that output does not contain sensitive PII
 * Throws an error if critical PII types are found
 *
 * @param text - The text to validate
 * @param criticalTypes - PII types that should cause validation to fail
 * @throws Error if critical PII is found
 */
export function validateNoPII(
  text: string,
  criticalTypes: PIIType[] = ["ssn", "credit_card", "api_key"]
): void {
  const result = detectPII(text, { types: criticalTypes, logDetections: false });

  if (result.containsPII) {
    const summary = getPIISummary(result);
    logger.error(
      {
        piiTypes: Object.entries(result.summary)
          .filter(([, count]) => count > 0)
          .map(([type]) => type),
        piiCount: result.detections.length,
      },
      "Critical PII found in output"
    );
    throw new Error(`Output contains sensitive PII: ${summary}`);
  }
}
