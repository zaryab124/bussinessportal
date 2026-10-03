const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const testDir = __dirname;
const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .map(f => path.join(testDir, f));

if (files.length === 0) {
  console.log('No test files found in tests/');
  process.exit(0);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
