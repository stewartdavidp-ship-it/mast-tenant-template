#!/usr/bin/env node
/**
 * sync-workflows.js
 *
 * Reads docs/workflows.yaml, parses it, splits workflows by section,
 * and writes structured data to Firebase RTDB for the Studio Assistant.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/sync-workflows.js
 *   node scripts/sync-workflows.js --dry-run
 *
 * Environment:
 *   FIREBASE_SERVICE_ACCOUNT  — JSON string of GCP service account key
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { GoogleAuth } = require('google-auth-library');

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://mast-platform-prod-default-rtdb.firebaseio.com';
const TENANT_ID = process.env.TENANT_ID || 'dev';
const WORKFLOWS_PATH = path.resolve(__dirname, '..', 'docs', 'workflows.yaml');
const FIREBASE_PATH = '/' + TENANT_ID + '/workflows';

const DRY_RUN = process.argv.includes('--dry-run');

async function getAccessToken() {
  const credJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!credJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT env var is required (JSON string of service account key)');
  }

  const credentials = JSON.parse(credJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email']
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function writeToFirebase(payload, accessToken) {
  const url = `${FIREBASE_DB_URL}${FIREBASE_PATH}.json`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firebase write failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function main() {
  // Read and parse workflows
  console.log(`Reading ${WORKFLOWS_PATH}...`);
  const raw = fs.readFileSync(WORKFLOWS_PATH, 'utf8');

  const parsed = yaml.load(raw);
  if (!parsed || !parsed.workflows) {
    throw new Error('Could not parse workflows.yaml — missing "workflows" key');
  }

  const workflows = parsed.workflows;
  console.log(`Parsed ${workflows.length} workflow entries`);

  // Group by section
  const sections = {};
  for (const wf of workflows) {
    const sec = wf.section || 'Uncategorized';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(wf);
  }

  const sectionNames = Object.keys(sections).sort();
  console.log(`Found ${sectionNames.length} sections: ${sectionNames.join(', ')}`);

  // Build section YAML strings
  const sectionYaml = {};
  for (const [name, entries] of Object.entries(sections)) {
    sectionYaml[name] = yaml.dump(entries, { lineWidth: -1, noRefs: true });
  }

  // Handle not_yet_built if present
  let notYetBuiltYaml = null;
  if (parsed.not_yet_built) {
    notYetBuiltYaml = yaml.dump(parsed.not_yet_built, { lineWidth: -1, noRefs: true });
    console.log(`Found ${parsed.not_yet_built.length} not-yet-built entries`);
  }

  // Build payload
  const payload = {
    full: raw,
    sections: sectionYaml,
    syncedAt: new Date().toISOString(),
    sectionList: sectionNames
  };
  if (notYetBuiltYaml) {
    payload.not_yet_built = notYetBuiltYaml;
  }

  // Report sizes
  const fullSize = raw.length;
  console.log(`\nSection sizes (chars):`);
  for (const name of sectionNames) {
    const size = sectionYaml[name].length;
    const count = sections[name].length;
    console.log(`  ${name}: ${size.toLocaleString()} chars (${count} workflows)`);
  }
  console.log(`  FULL: ${fullSize.toLocaleString()} chars`);

  if (DRY_RUN) {
    console.log('\n--dry-run: skipping Firebase write');
    console.log(`Would write to: ${FIREBASE_DB_URL}${FIREBASE_PATH}`);
    return;
  }

  // Write to Firebase
  console.log('\nAuthenticating with GCP service account...');
  const token = await getAccessToken();

  console.log(`Writing to Firebase: ${FIREBASE_DB_URL}${FIREBASE_PATH}`);
  await writeToFirebase(payload, token);

  console.log('Done! Workflows synced to Firebase.');
  console.log(`  Path: ${FIREBASE_PATH}`);
  console.log(`  Sections: ${sectionNames.length}`);
  console.log(`  Synced at: ${payload.syncedAt}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
