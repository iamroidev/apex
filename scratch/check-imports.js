const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../public/src');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

const exportsMap = {}; // filename -> Set of exported names
const importsList = []; // list of { importerFile, importedFile, symbols: [] }

files.forEach(file => {
  const filePath = path.join(srcDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // Simple parser for exports
  const exports = new Set();
  
  // export function name(...)
  const funcRegex = /export\s+(async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    exports.add(match[2]);
  }

  // export const/let/var name
  const varRegex = /export\s+(const|let|var)\s+(\w+)/g;
  while ((match = varRegex.exec(content)) !== null) {
    exports.add(match[2]);
  }

  // export { name1, name2 }
  const listRegex = /export\s+\{([^}]+)\}/g;
  while ((match = listRegex.exec(content)) !== null) {
    const list = match[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim());
    list.forEach(name => {
      if (name) exports.add(name);
    });
  }

  exportsMap[file] = exports;

  // Simple parser for imports
  // import { a, b } from './file.js';
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/g;
  while ((match = importRegex.exec(content)) !== null) {
    const symbols = match[1].split(',').map(s => s.trim().split(/\s+as\s+/).shift().trim()).filter(Boolean);
    const targetFile = match[2];
    importsList.push({
      importer: file,
      target: targetFile,
      symbols
    });
  }
});

let errorsCount = 0;
importsList.forEach(({ importer, target, symbols }) => {
  const targetExports = exportsMap[target];
  if (!targetExports) {
    console.error(`Error: Importer ${importer} references non-existent file or unparsed file: ${target}`);
    errorsCount++;
    return;
  }
  symbols.forEach(symbol => {
    if (!targetExports.has(symbol)) {
      console.error(`Error: File '${importer}' imports '${symbol}' from './${target}', but './${target}' does not export it.`);
      errorsCount++;
    }
  });
});

if (errorsCount === 0) {
  console.log('All imports and exports matched up successfully! 🎉');
  process.exit(0);
} else {
  console.error(`Total errors: ${errorsCount}`);
  process.exit(1);
}
