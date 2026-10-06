import fs from 'fs';
import { findForeignResolved } from '../src/lib/lockfile-registry';

const foreign = findForeignResolved(JSON.parse(fs.readFileSync('package-lock.json', 'utf8')));
if (foreign.length) {
  console.error(`package-lock.json resolves ${foreign.length} package(s) outside https://registry.npmjs.org/:`);
  for (const f of foreign.slice(0, 20)) console.error(`  ${f}`);
  console.error('Re-install with --registry=https://registry.npmjs.org (your ~/.npmrc points elsewhere).');
  process.exit(1);
}
console.log('package-lock.json: all packages resolve from the public registry');
