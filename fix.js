const fs = require('fs');

function fixFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  // Replace escaped backticks with regular backticks
  content = content.replace(/\\`/g, '`');
  // Replace escaped interpolation with regular interpolation
  content = content.replace(/\\\$\{/g, '${');
  fs.writeFileSync(path, content, 'utf8');
  console.log(`Fixed ${path}`);
}

fixFile('lib/ai.ts');
fixFile('lib/telegram.ts');
fixFile('lib/subsystems.ts');
