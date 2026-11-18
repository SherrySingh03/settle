// js/app.js is written as ordered pieces in src/js/app/ (00-core.js, 10-paint.js, ...) that share one scope. The preview
// server and the build join them, in file-name order, inside a single function: the TV runs exactly one app.js, as it
// always did, and every piece can still see every other piece's functions and state.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function joinApp(srcDir) {
  const dir = join(srcDir, 'js', 'app');
  const parts = readdirSync(dir).filter((n) => n.endsWith('.js')).sort()
    .map((n) => '/* ---- ' + n + ' ---- */\n' + readFileSync(join(dir, n), 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n');
  return '/* Settle: shell, focus model, clock. No framework. Joined from src/js/app/. */\n(function () {\n\'use strict\';\n\n' + parts.join('\n') + '})();\n';
}
