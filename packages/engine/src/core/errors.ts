/** Malformed request that cannot be attributed to a known claim/actor; not audited. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export class ClaimNotFoundError extends Error {
  constructor(readonly claimId: string) {
    super(`Claim ${claimId} not found`);
    this.name = 'ClaimNotFoundError';
  }
}
