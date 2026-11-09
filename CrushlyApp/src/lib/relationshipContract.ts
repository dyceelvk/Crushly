/**
 * Public compatibility marker for the coordinated relationship-model release.
 * It is deliberately not a secret or an authorization mechanism: server-side
 * identity, privacy, block and permission checks remain the security boundary.
 */
export const RELATIONSHIP_CONTRACT_HEADER = 'x-holup-contract';
export const RELATIONSHIP_CONTRACT_VERSION = 'relationship-v2';

export const relationshipContractHeaders = (): Record<string, string> => ({
  [RELATIONSHIP_CONTRACT_HEADER]: RELATIONSHIP_CONTRACT_VERSION,
});
