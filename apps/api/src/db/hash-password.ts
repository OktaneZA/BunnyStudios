/**
 * Operator utility: turn a plaintext password into the scrypt hash that goes into
 * AUTH_*_PASSWORD_HASH. Plaintext never reaches the database or a config file.
 *
 *   node src/db/hash-password.ts 'the password'
 */
import { hashPassword } from '../auth.ts';

const password = process.argv[2];
if (!password) {
  console.error("usage: node src/db/hash-password.ts '<password>'");
  process.exit(1);
}
console.log(await hashPassword(password));
