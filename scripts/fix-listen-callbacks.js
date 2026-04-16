#!/usr/bin/env node
// Fix listen/subscribe callbacks that still use snap.val() pattern.
// Entity listen() methods now pass values directly to callbacks.
// Also fixes .then(function(snap) { snap.val() }) on entity methods and MastDB.get().

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
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern 1: MastDB.xxx.listen(N, function(snap) {
    // Next line likely: var data = snap.val() || {};
    const listenMatch = line.match(/(\w+Listener)\s*=\s*(?:MastDB\.\w+(?:\.\w+)?\.listen|DB\.\w+(?:\.\w+)?\.listen)\([^,]*,?\s*function\((\w+)\)\s*\{/);
    if (listenMatch) {
      const snapVar = listenMatch[2];
      if (snapVar === 'snap' || snapVar === 's') {
        // Check next few lines for snap.val()
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (lines[j].includes(snapVar + '.val()')) {
            // Replace snap.val() || {} with just the variable
            const valMatch = lines[j].match(new RegExp(`var (\\w+) = ${snapVar}\\.val\\(\\)( \\|\\| \\{\\})?;`));
            if (valMatch) {
              const valVar = valMatch[1];
              // Rename callback param and remove val() line
              lines[i] = line.replace(`function(${snapVar})`, `function(${valVar})`);
              if (valMatch[2]) {
                // Had || {} default — add it to the callback param
                lines[i] = lines[i]; // param gets the value directly
                lines[j] = lines[j].replace(new RegExp(`var ${valVar} = ${snapVar}\\.val\\(\\)( \\|\\| \\{\\})?;`),
                  `${valVar} = ${valVar} || {};`);
              } else {
                lines[j] = ''; // Remove the line entirely
              }
              fixes++;
              break;
            }
          }
        }
      }
    }

    // Pattern 2: MastDB.xxx.listen(function(snap) { — no limit arg (tokenWallet, etc.)
    const listenNoLimitMatch = line.match(/(\w+)\s*=\s*(?:MastDB\.\w+\.listen|MastDB\.subscribe)\(function\((\w+)\)\s*\{/);
    if (listenNoLimitMatch) {
      const snapVar = listenNoLimitMatch[2];
      if (snapVar === 'snap' || snapVar === 's') {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (lines[j].includes(snapVar + '.val()')) {
            const valMatch = lines[j].match(new RegExp(`var (\\w+) = ${snapVar}\\.val\\(\\)( \\|\\| \\{\\})?;`));
            if (valMatch) {
              const valVar = valMatch[1];
              lines[i] = line.replace(`function(${snapVar})`, `function(${valVar})`);
              if (valMatch[2]) {
                lines[j] = lines[j].replace(new RegExp(`var ${valVar} = ${snapVar}\\.val\\(\\)( \\|\\| \\{\\})?;`),
                  `${valVar} = ${valVar} || {};`);
              } else {
                lines[j] = '';
              }
              fixes++;
              break;
            }
          }
        }
      }
    }

    // Pattern 3: .then(function(snap) { var val = snap.val() — after MastDB.get/config calls
    const thenMatch = line.match(/\.then\(function\((\w+)__val\)\s*\{/);
    if (thenMatch) {
      // This was converted by the migration script: snap → snap__val
      // Fix: rename to just 'val' and fix snap__val.val() references
      const wrongVar = thenMatch[1] + '__val';
      // Check next few lines for wrongVar usage
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].includes(wrongVar + '.val()')) {
          lines[j] = lines[j].replace(new RegExp(wrongVar + '\\.val\\(\\)( \\|\\| \\{\\})?', 'g'), function(m, def) {
            fixes++;
            return def ? `(${wrongVar} || {})` : wrongVar;
          });
        }
        // Also fix var x = wrongVar; (unnecessary assignment)
        const reassign = lines[j].match(new RegExp(`var (\\w+) = ${wrongVar};`));
        if (reassign) {
          // Replace wrongVar with the reassignment target everywhere after
          const target = reassign[1];
          lines[j] = lines[j].replace(new RegExp(`var ${target} = ${wrongVar};`), `var ${target} = ${wrongVar};`);
          // Actually, just rename __val to a clean name
        }
      }
    }
  }

  // Pattern 4: Global cleanup — rename snap__val to val in .then callbacks
  let joined = lines.join('\n');
  joined = joined.replace(/function\((\w+)__val\)\s*\{/g, function(m, base) {
    fixes++;
    return `function(${base}Val) {`;
  });
  // Fix references to old __val name
  joined = joined.replace(/(\w+)__val/g, function(m, base) {
    return `${base}Val`;
  });

  if (fixes > 0) {
    totalFixes += fixes;
    console.log(`${rel}: ${fixes} listen/callback fixes`);
    fs.writeFileSync(file, joined, 'utf8');
  }
}

console.log(`\nTotal listen/callback fixes: ${totalFixes}`);
