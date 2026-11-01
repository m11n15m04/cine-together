export interface NxshaEmbedTestConfig {
  enabled?: string;
  accountUid?: string;
}

/** The private embed trial is opt-in and restricted to one configured Firebase account. */
export function canUseNxshaEmbedTest(uid: string | undefined, config: NxshaEmbedTestConfig): boolean {
  const configuredUid = config.accountUid?.trim();
  return config.enabled === 'true' && Boolean(uid && configuredUid && uid === configuredUid);
}
