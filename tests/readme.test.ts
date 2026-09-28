import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const EXTERNAL_TARGET = /^(https?:|mailto:|#)/;

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

describe('README.md', () => {
  // Automated clients log in with the README's platform-admin credentials
  // (contract §5), so the documented values must stay equal to what a fresh clone seeds.
  it('lists every seed value of .env.example', () => {
    const readme = read('README.md');
    const seed = Object.entries(parseEnv(read('.env.example'))).filter(([name]) =>
      name.startsWith('SEED_'),
    );

    expect(seed).toHaveLength(8);
    for (const [name, value] of seed) {
      expect(readme, name).toContain(value);
    }
  });
});

describe.each(['README.md', 'docs/README.md', 'DESIGN.md'])('relative links in %s', (file) => {
  it('point to files or folders that exist', () => {
    const folder = path.dirname(path.join(REPO_ROOT, file));
    const targets = [...read(file).matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((target) => !EXTERNAL_TARGET.test(target))
      .map((target) => target.split('#')[0] ?? '');

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(existsSync(path.join(folder, decodeURIComponent(target))), target).toBe(true);
    }
  });
});
