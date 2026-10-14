// Public build provenance only; never include environment/config/credential values.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const revision = process.env.GITHUB_SHA || process.env.COMMIT_REF || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid deployment revision');
await writeFile('dist/deployment.json', JSON.stringify({ revision, builtAt: new Date().toISOString() }) + '\n');
