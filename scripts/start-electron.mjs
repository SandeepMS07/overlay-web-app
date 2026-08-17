/**
 * Launches Electron with a sanitised environment.
 *
 * VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE=1 for its own
 * helper processes. Inherited by our launch, it makes the Electron binary boot
 * as plain Node, so `require('electron').app` is undefined and the app dies on
 * startup. Stripping it here keeps `npm run dev` working from any terminal.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
