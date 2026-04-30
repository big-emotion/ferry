export function isDryRun(): boolean {
  return process.env.FERRY_DRY_RUN === '1' || process.env.FERRY_DRY_RUN === 'true';
}
