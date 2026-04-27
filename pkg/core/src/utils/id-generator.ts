// Framework-agnostic ID generation utilities for Flowlib core
import { createUrlSafeIdGenerator } from './url-safe-id';

/**
 * ID generation utilities
 */
export class IdGenerator {
  // Hex alphabet for flow IDs
  private static readonly HEX_ALPHABET = '0123456789abcdef';

  // Create nanoid function for 7-char hex flow IDs
  private static readonly nanoid7hex = createUrlSafeIdGenerator({
    alphabet: IdGenerator.HEX_ALPHABET,
    size: 7,
  });

  /**
   * Generate a flow ID as a 7-character random hex string
   * Example: "a3f09b2"
   */
  static generateFlowId(_flowName?: string): string {
    return IdGenerator.nanoid7hex();
  }

  /**
   * Validate flow ID format
   */
  static isValidFlowId(flowId: string): boolean {
    if (!flowId || typeof flowId !== 'string') {
      return false;
    }

    // Flow ID should be exactly 7 lowercase hex characters
    return /^[0-9a-f]{7}$/.test(flowId);
  }
}
