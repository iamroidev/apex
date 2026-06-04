const fs = require('fs');

function makeAsync(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/router\.(get|post|delete)\('([^']+)',\s*(authenticate,\s*)?\(req, res\) => {/g, "router.$1('$2', $3async (req, res) => {");
  fs.writeFileSync(file, content);
}

makeAsync('src/routes/api.js');
