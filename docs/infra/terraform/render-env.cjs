// Writes the backend .env from the SSM parameters, so the app reads back EXACTLY the stored values.
// Runs on the instance during bootstrap (embedded by user_data.sh.tpl), from /opt/nasa/Backend, with that release's
// own dotenv. Usage: node render-env.cjs <get-parameters-by-path JSON> <app port>   (prints the .env to stdout)
//
// Why not KEY="<json>": dotenv strips the outer quotes and expands only \n and \r inside double quotes. It never
// unescapes \\ or \", so a value holding a backslash or a double quote arrived changed. Instead, each value is put in
// the first quote style dotenv leaves untouched for it, and the whole file is parsed back with dotenv and compared.
// Any setting that would not survive stops the bootstrap by name (never by value): better no server than a wrong one.
'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The first quote style that dotenv 17 returns unchanged for this value, or null if none does.
function quote(value) {
  if (value.includes('\r')) return null; // dotenv turns every \r into \n before parsing
  if (value.endsWith('\\')) return null; // a trailing backslash would escape the closing quote
  if (!value.includes("'")) return "'" + value + "'"; // single quotes: no expansion at all, line breaks kept
  if (!value.includes('"') && !/\\[nr]/.test(value)) return '"' + value + '"'; // double quotes expand \n and \r
  if (!value.includes('`')) return '`' + value + '`';
  return null;
}

// Pure: settings object in, { text, bad } out. Exported for the test.
function render(settings, parse) {
  const bad = [];
  const lines = [];
  for (const [name, value] of Object.entries(settings)) {
    const quoted = NAME.test(name) && typeof value === 'string' ? quote(value) : null;
    if (quoted === null) bad.push(name);
    else lines.push(name + '=' + quoted);
  }
  const text = lines.join('\n') + '\n';
  const back = parse(text);
  for (const [name, value] of Object.entries(settings)) {
    if (!bad.includes(name) && back[name] !== value) bad.push(name);
  }
  for (const name of Object.keys(back)) if (!(name in settings)) bad.push(name);
  return { text, bad };
}

function settingsFrom(parameters, port) {
  const fixed = { NODE_ENV: 'production', PORT: String(port), TRUST_PROXY: '1' }; // set by the bootstrap, not SSM
  const settings = { ...fixed };
  const ignored = [];
  for (const p of parameters) {
    const name = p.Name.split('/').pop();
    if (name in fixed) ignored.push(name);
    else settings[name] = p.Value;
  }
  return { settings, ignored };
}

if (require.main === module) {
  const [jsonPath, port] = process.argv.slice(2);
  if (!jsonPath || !port) {
    console.error('usage: render-env.cjs <parameters.json> <port>');
    process.exit(2);
  }
  const dotenv = createRequire(path.join(process.cwd(), 'package.json'))('dotenv');
  const { Parameters = [] } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const { settings, ignored } = settingsFrom(Parameters, port);
  if (ignored.length) console.error('render-env: ignored from SSM (the bootstrap sets these): ' + ignored.join(', '));
  const { text, bad } = render(settings, dotenv.parse);
  if (bad.length) {
    console.error('render-env: FATAL, these settings would not reach the app unchanged: ' + bad.join(', '));
    process.exit(1);
  }
  process.stdout.write(text);
}

module.exports = { quote, render, settingsFrom };
