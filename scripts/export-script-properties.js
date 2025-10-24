const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.error('Arquivo .env não encontrado em: ' + envPath);
  process.exit(1);
}

const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const props = {};

for (const rawLine of lines) {
  const line = rawLine.trim();

  if (!line || line.startsWith('#')) {
    continue;
  }

  const idx = line.indexOf('=');

  if (idx === -1) {
    continue;
  }

  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();

  if (!key) {
    continue;
  }

  props[key] = value;
}

const serialized = JSON.stringify(props, null, 2);

const script = [
  'function seedPropertiesFromEnv() {',
  '  PropertiesService.getScriptProperties().setProperties(' + serialized.replace(/\n/g, '\n  ') + ');',
  '}',
  '',
  '// Execute uma única vez no Apps Script para sincronizar as Script Properties.'
].join('\n');

console.log(script);
