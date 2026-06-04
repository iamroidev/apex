const fs = require('fs');

let content = fs.readFileSync('src/sockets/index.js', 'utf8');

// Replace socket.on(..., (...) => { with async
content = content.replace(/socket\.on\('([^']+)',\s*\(([^)]*)\)\s*=>\s*{/g, "socket.on('$1', async ($2) => {");

fs.writeFileSync('src/sockets/index.js', content);
