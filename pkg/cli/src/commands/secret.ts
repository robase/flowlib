/**
 * `npx flowlib-cli secret` — Generate a secure encryption key
 *
 * Generates a cryptographically secure 32-byte key (base64-encoded)
 * suitable for use as FLOWLIB_ENCRYPTION_KEY.
 *
 * Usage:
 *   npx flowlib-cli secret
 */

import { Command } from 'commander';
import crypto from 'crypto';
import pc from 'picocolors';

export const secretCommand = new Command('secret')
  .description('Generate a secure encryption key for FLOWLIB_ENCRYPTION_KEY')
  .action(() => {
    const key = crypto.randomBytes(32).toString('base64');

    console.log(pc.bold('\n🔑 Generated Encryption Key\n'));
    console.log(`  ${pc.green(key)}`);
    console.log('');
    console.log(pc.dim('  Add this to your environment:'));
    console.log(pc.dim(`    FLOWLIB_ENCRYPTION_KEY="${key}"`));
    console.log('');
    console.log(pc.dim('  This key is used for AES-256-GCM encryption of credentials.'));
    console.log(pc.dim('  Store it securely — losing it means losing access to encrypted data.\n'));
  });
