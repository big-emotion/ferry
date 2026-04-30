import { scanWithGitleaks } from '../safety/scan.js';
import { FerryError } from '../errors/index.js';

export function makeSecretScan(repoRoot: string): () => Promise<void> {
  return async () => {
    const scanResult = await scanWithGitleaks({
      path: repoRoot,
      binaryPath: process.env.GITLEAKS_PATH ?? 'gitleaks',
    });
    if (scanResult.leaksFound) {
      throw new FerryError('state-invariant', {
        reason: 'secret-scan-hit',
        findings: scanResult.findings.length,
      });
    }
  };
}
