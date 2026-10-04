const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.env.NODE_ENV = 'test';

const testDir = __dirname;
const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  .map(f => path.join(testDir, f));

if (files.length === 0) {
  console.log('No test files found in tests/');
  process.exit(0);
}

async function runTestsSequentially() {
  for (const file of files) {
    const filename = path.basename(file);
    console.log(`\n========================================`);
    console.log(` RUNNING: ${filename}`);
    console.log(`========================================`);

    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--test', file], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test' }
      });
      child.on('exit', (code) => resolve(code || 0));
    });

    if (code !== 0) {
      console.error(`\nTest suite failed: ${filename}`);
      process.exit(code);
    }
  }
  console.log('\n========================================');
  console.log(' ALL TEST SUITES PASSED SUCCESSFULLY');
  console.log('========================================\n');
  process.exit(0);
}

runTestsSequentially();
