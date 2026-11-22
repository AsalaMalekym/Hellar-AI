import { spawn } from 'node:child_process';
const arg = process.argv.slice(2);
const frontend = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...arg], {
  stdio: 'inherit',
});
const backend = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', '--import', 'tsx', 'server/index.ts'],
  { stdio: 'inherit' },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  frontend.kill();
  backend.kill();
  setTimeout(() => process.exit(code), 150);
}
for (const child of [frontend, backend]) child.on('exit', (c) => stop(c || 0));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
