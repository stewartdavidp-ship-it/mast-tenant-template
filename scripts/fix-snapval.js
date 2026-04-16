#!/usr/bin/env node
// Fix snap.val() patterns after entity methods now return values directly.
// Entity get/list/listen methods previously returned DataSnapshot,
// now return raw values. Callers that do snap.val() need updating.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let totalFixes = 0;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'shared', 'scripts', 'docs'].includes(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.js'))) {
      out.push(path.join(dir, entry.name));
    }
  }
}

const files = [];
walk(path.join(ROOT, 'app'), files);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  let fixes = 0;

  // Pattern 1: var snap = await MastDB.xxx.get(...); var val = snap.val();
  // → var val = await MastDB.xxx.get(...);
  src = src.replace(/var (\w+) = await (MastDB\.\w+(?:\.\w+)?\.(?:get|list|summary|recent|square|etsy|shipping|shippingProvider|taxRates|googleMaps|testMode|githubToken|settings|settingsField|migrationFlag|analyticsHits|makerSettings|shopDisplay|allDrivers|listAll|queryPending|queryByOrder|queryByJob|bySession|byClass|byContact|byStatus|byType)\([^)]*\));\s*\n(\s*)var (\w+) = \1\.val\(\)( \|\| \{\})?;/g,
    function(m, snapVar, call, indent, valVar, defaultEmpty) {
      fixes++;
      if (defaultEmpty) return `var ${valVar} = (await ${call}) || {};`;
      return `var ${valVar} = await ${call};`;
    });

  // Pattern 2: var snap = await MastDB.xxx.get(...); \n data = snap.val();
  src = src.replace(/var (\w+) = await (MastDB\.\w+(?:\.\w+)?\.(?:get|list)\([^)]*\));\s*\n(\s*)(\w+) = \1\.val\(\)( \|\| \{\})?;/g,
    function(m, snapVar, call, indent, valVar, defaultEmpty) {
      fixes++;
      if (defaultEmpty) return `${valVar} = (await ${call}) || {};`;
      return `${valVar} = await ${call};`;
    });

  // Pattern 3: var snap = await MastDB.xxx.get(...); if (!snap.val()) / if (snap.val())
  src = src.replace(/var (\w+) = await (MastDB\.\w+(?:\.\w+)?\.(?:get|list)\([^)]*\));\s*\n(\s*)if \(!?\1\.val\(\)\)/g,
    function(m, snapVar, call, indent) {
      fixes++;
      const negated = m.includes('!');
      return `var ${snapVar} = await ${call};\n${indent}if (${negated ? '!' : ''}${snapVar})`;
    });

  // Pattern 4: var snap = await MastDB.xxx.get(...); then snap.val() used later
  // This is harder — handle the most common sub-patterns:

  // 4a: snap.val() || {} inline
  // Find remaining snapVar.val() references after entity get/list calls
  // We need multi-line awareness. Do a second pass:
  const lines = src.split('\n');
  const snapVars = new Map(); // snapVar → line where it was assigned from entity get/list

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Track entity get/list assignments
    const assignMatch = line.match(/var (\w+) = await (MastDB\.\w+(?:\.\w+)?\.(?:get|list|summary|recent|allDrivers|listAll|queryPending|queryByOrder|queryByJob|bySession|byClass|byContact|byStatus|byType)\([^)]*\));/);
    if (assignMatch) {
      snapVars.set(assignMatch[1], i);
    }

    // Check for snapVar.val() usage
    for (const [snapVar, assignLine] of snapVars) {
      if (i > assignLine && i < assignLine + 5) { // Within 5 lines
        if (line.includes(snapVar + '.val()')) {
          // Replace snapVar.val() with snapVar
          lines[i] = line.replace(new RegExp(snapVar + '\\.val\\(\\)( \\|\\| \\{\\})?', 'g'), function(m, defaultEmpty) {
            fixes++;
            return defaultEmpty ? `(${snapVar} || {})` : snapVar;
          });
        }
        // Also handle snap.exists() → snap != null
        if (line.includes(snapVar + '.exists()')) {
          lines[i] = line.replace(new RegExp(snapVar + '\\.exists\\(\\)', 'g'), function() {
            fixes++;
            return `(${snapVar} != null)`;
          });
        }
      }
    }
  }
  src = lines.join('\n');

  // Pattern 5: .then(function(snap) { var data = snap.val() ...}) after entity calls
  // MastDB.xxx.get/list().then(function(snap) { var val = snap.val() || {}; ...
  // → MastDB.xxx.get/list().then(function(val) { ...
  src = src.replace(/(MastDB\.\w+(?:\.\w+)?\.(?:get|list|summary|recent|allDrivers|listAll|queryPending|queryByOrder|queryByJob|bySession|byClass|byContact|byStatus|byType)\([^)]*\))\.then\(function\((\w+)\)\s*\{\s*\n(\s*)var (\w+) = \2\.val\(\)( \|\| \{\})?;/g,
    function(m, call, snapVar, indent, valVar, defaultEmpty) {
      fixes++;
      if (defaultEmpty) return `${call}.then(function(${valVar}) {\n${indent}${valVar} = ${valVar} || {};`;
      return `${call}.then(function(${valVar}) {`;
    });

  // Pattern 6: DB.xxx.get/list().then(function(snap) — events module DB object
  src = src.replace(/(DB\.\w+(?:\.\w+)?\.(?:get|list)\([^)]*\))\.then\(function\((\w+)\)\s*\{\s*\n(\s*)var (\w+) = \2\.val\(\)( \|\| \{\})?;/g,
    function(m, call, snapVar, indent, valVar, defaultEmpty) {
      fixes++;
      if (defaultEmpty) return `${call}.then(function(${valVar}) {\n${indent}${valVar} = ${valVar} || {};`;
      return `${call}.then(function(${valVar}) {`;
    });

  // Pattern 7: listen/subscribe callbacks that receive values now
  // These are harder to detect programmatically.
  // The entity listen() methods now pass values to callbacks, not snapshots.
  // Flag these for manual review rather than auto-fix.

  if (fixes > 0) {
    totalFixes += fixes;
    console.log(`${rel}: ${fixes} snap.val() fixes`);
    fs.writeFileSync(file, src, 'utf8');
  }
}

console.log(`\nTotal snap.val() fixes: ${totalFixes}`);

// Count remaining snap.val() for awareness
const { execSync } = require('child_process');
const remaining = execSync(
  `grep -rn "snap\\.val\\(\\)\\|\\.val()" app/ --include="*.html" --include="*.js" | grep -v "mastdb.js" | grep -v "// " | grep -v "\\.once('value')" | wc -l`,
  { cwd: ROOT, encoding: 'utf8' }
).trim();
console.log(`Remaining .val() calls: ${remaining} (many are legitimate — listen callbacks, non-entity code)`);
