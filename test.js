const fs = require('fs');
const content = fs.readFileSync('lib/ai.ts', 'utf8');
console.log(content.includes('\\`'));
