// Removes previous build output so deleted source files never linger in dist/.
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
