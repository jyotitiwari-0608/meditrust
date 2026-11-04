import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
