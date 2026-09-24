// Makes `npm start` work on a clean machine without manual steps:
// 1. creates .env from .env.example when it is missing,
// 2. fills an empty JWT_SECRET with a random value (secrets never live in the repository).
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const envFile = new URL('../.env', import.meta.url);
const exampleFile = new URL('../.env.example', import.meta.url);

if (!existsSync(envFile)) {
  copyFileSync(exampleFile, envFile);
  console.log('[ensure-env] Created .env from .env.example');
}

const content = readFileSync(envFile, 'utf8');
const secret = randomBytes(48).toString('base64url');
const emptySecretLine = /^JWT_SECRET=[ \t]*(\r?)$/m;

if (emptySecretLine.test(content)) {
  writeFileSync(envFile, content.replace(emptySecretLine, `JWT_SECRET=${secret}$1`));
  console.log('[ensure-env] Generated a random JWT_SECRET in .env');
} else if (!/^JWT_SECRET=/m.test(content)) {
  const separator = content.endsWith('\n') ? '' : '\n';
  writeFileSync(envFile, `${content}${separator}JWT_SECRET=${secret}\n`);
  console.log('[ensure-env] Added a random JWT_SECRET to .env');
}
