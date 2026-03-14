# Clone Runbook — New Tenant Setup

This document covers the full end-to-end process for creating a new Mast tenant from the template repo. Steps are divided into **manual prerequisites** (GCP Console, third-party dashboards) and **automated steps** (scripts).

---

## Overview

```
1. Manual: Create Firebase project + enable services
2. Manual: Set up secrets in Secret Manager
3. Manual: IAM bindings for Mast platform SA
4. Manual: Square Developer Dashboard setup
5. Script: Clone tenant repo (scripts/clone-tenant.sh)
6. Script: Register tenant on Mast platform (scripts/register-tenant.sh)
7. Manual: Import seed data to Firebase
8. Manual: Deploy Cloud Functions
9. Manual: DNS configuration
10. Script: Deploy site via mast_hosting
```

---

## 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project**
3. Project name: use `mast-tenant-{name}` convention (e.g., `mast-tenant-demo`)
4. Disable Google Analytics (not needed for tenant apps)
5. Wait for project creation

### Enable Services

In the Firebase Console for the new project:

- **Realtime Database:** Build → Realtime Database → Create Database → Start in **locked mode** → Region: `us-central1`
- **Authentication:** Build → Authentication → Get Started → Enable **Google** sign-in provider
- **Storage:** Build → Storage → Get Started → Start in **production mode**
- **Functions:** Upgrade to **Blaze (pay-as-you-go)** plan if not already (required for Cloud Functions)

### Collect Firebase Config Values

Go to Project Settings → General → Your apps → Add a **Web app**:
- App nickname: `{tenant-name} Storefront`
- Do NOT enable Firebase Hosting here (handled by Mast platform)
- Copy the `firebaseConfig` object — you'll need these values for the clone script:
  - `apiKey`
  - `authDomain`
  - `databaseURL`
  - `projectId`
  - `storageBucket`

---

## 2. Set Up Secret Manager

In the [GCP Console](https://console.cloud.google.com/) for the new project:

### Required Secrets

```bash
# Square API credentials
gcloud secrets create square-access-token \
  --project={firebase-project} \
  --replication-policy="automatic"

gcloud secrets versions add square-access-token \
  --project={firebase-project} \
  --data-file=- <<< "YOUR_SQUARE_ACCESS_TOKEN"

gcloud secrets create square-webhook-signature-key \
  --project={firebase-project} \
  --replication-policy="automatic"

gcloud secrets versions add square-webhook-signature-key \
  --project={firebase-project} \
  --data-file=- <<< "YOUR_SQUARE_WEBHOOK_SIGNATURE_KEY"

# SendGrid API key (for transactional emails)
gcloud secrets create sendgrid-api-key \
  --project={firebase-project} \
  --replication-policy="automatic"

gcloud secrets versions add sendgrid-api-key \
  --project={firebase-project} \
  --data-file=- <<< "YOUR_SENDGRID_API_KEY"

# Anthropic API key (for AI features — studio assistant, shoot cards, etc.)
gcloud secrets create anthropic-api-key \
  --project={firebase-project} \
  --replication-policy="automatic"

gcloud secrets versions add anthropic-api-key \
  --project={firebase-project} \
  --data-file=- <<< "YOUR_ANTHROPIC_API_KEY"
```

### Grant Cloud Functions access to secrets

```bash
# Get the project number
PROJECT_NUMBER=$(gcloud projects describe {firebase-project} --format='value(projectNumber)')

# Grant the default compute SA access to read secrets
gcloud secrets add-iam-policy-binding square-access-token \
  --project={firebase-project} \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Repeat for each secret:
for SECRET in square-webhook-signature-key sendgrid-api-key anthropic-api-key; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --project={firebase-project} \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 3. IAM Bindings — Mast Platform Service Account

The Mast MCP server (running on `mast-platform-prod`) needs access to the new tenant's RTDB and Secret Manager for hosting deployments and platform management.

```bash
MAST_SA="mast-mcp-server@mast-platform-prod.iam.gserviceaccount.com"

# Grant RTDB access (Firebase Admin SDK uses this)
gcloud projects add-iam-policy-binding {firebase-project} \
  --member="serviceAccount:${MAST_SA}" \
  --role="roles/firebasedatabase.admin"

# Grant Secret Manager read access
gcloud projects add-iam-policy-binding {firebase-project} \
  --member="serviceAccount:${MAST_SA}" \
  --role="roles/secretmanager.secretAccessor"

# Grant Firebase Hosting admin (for mast_hosting deploys)
gcloud projects add-iam-policy-binding {firebase-project} \
  --member="serviceAccount:${MAST_SA}" \
  --role="roles/firebasehosting.admin"

# Grant Storage access (for product images)
gcloud projects add-iam-policy-binding {firebase-project} \
  --member="serviceAccount:${MAST_SA}" \
  --role="roles/storage.admin"
```

---

## 4. Square Developer Dashboard

1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps)
2. Either:
   - **Create a new application** for this tenant, OR
   - **Add a webhook URL** to an existing application
3. Configure webhook:
   - URL: `https://us-central1-{firebase-project}.cloudfunctions.net/squareWebhook`
   - Events: `payment.completed`
4. Note the following values (needed for admin app Settings):
   - Application ID (sandbox + production)
   - Location ID
   - Access Token (goes in Secret Manager, step 2)
   - Webhook Signature Key (goes in Secret Manager, step 2)

---

## 5. Run Clone Script

The clone script transforms the template repo for the new tenant.

```bash
cd /path/to/shirglassworks

# Dry run first — review all changes
./scripts/clone-tenant.sh \
  --tenant-id {tenantId} \
  --firebase-project {firebase-project} \
  --domain {domain} \
  --brand-name "{Brand Name}" \
  --owner-email owner@example.com \
  --dry-run

# If satisfied, run for real
./scripts/clone-tenant.sh \
  --tenant-id {tenantId} \
  --firebase-project {firebase-project} \
  --domain {domain} \
  --brand-name "{Brand Name}" \
  --owner-email owner@example.com
```

The script:
- Updates `storefront-tenant.js` (domain map, Firebase config, brand values)
- Replaces `<!-- TENANT: brand -->` and `<!-- TENANT: social -->` markers in HTML files
- Updates `.firebaserc` if present
- Generates `seed-data.json` for Firebase import

---

## 6. Register Tenant on Mast Platform

```bash
# Dry run first
./scripts/register-tenant.sh \
  --tenant-id {tenantId} \
  --brand-name "{Brand Name}" \
  --domain {domain} \
  --firebase-project {firebase-project} \
  --github-repo "owner/repo-name" \
  --dry-run

# If satisfied, run for real
./scripts/register-tenant.sh \
  --tenant-id {tenantId} \
  --brand-name "{Brand Name}" \
  --domain {domain} \
  --firebase-project {firebase-project} \
  --github-repo "owner/repo-name"
```

This registers the tenant in the Mast platform RTDB and configures hosting.

---

## 7. Import Seed Data

The clone script generates `seed-data.json`. Import it to the tenant's RTDB:

```bash
# Option A: Firebase CLI
firebase database:set / \
  --project {firebase-project} \
  --data seed-data.json \
  --merge

# Option B: REST API (curl)
DATABASE_URL="https://{firebase-project}-default-rtdb.firebaseio.com"

curl -X PATCH \
  "${DATABASE_URL}/.json?auth=YOUR_ADMIN_TOKEN" \
  -d @seed-data.json
```

> **Note:** Use `PATCH` (merge), not `PUT` (overwrite), to avoid clobbering any data already written by the registration step.

---

## 8. Deploy Cloud Functions

```bash
cd /path/to/tenant-functions

# Install dependencies
cd functions && npm install && cd ..

# Deploy all functions
firebase deploy --only functions --project {firebase-project}
```

---

## 9. Deploy Firebase Security Rules

Copy the template rules file and deploy:

```bash
# From the tenant functions directory
firebase deploy --only database --project {firebase-project}
```

---

## 10. DNS Configuration

Point the tenant's custom domain to Firebase Hosting:

1. In Firebase Console → Hosting → Add custom domain
2. Add both `{domain}` and `www.{domain}`
3. Firebase provides DNS records to add:
   - **A record:** `{domain}` → Firebase IP
   - **CNAME record:** `www.{domain}` → `{firebase-project}.web.app`
4. Add records in your DNS provider (Porkbun, GoDaddy, Cloudflare, etc.)
5. Wait for SSL certificate provisioning (can take up to 24 hours)

---

## 11. Deploy Site

Once DNS is configured and the repo is pushed to GitHub:

```bash
# Via Mast MCP tool
mast_hosting(action: "deploy", tenantId: "{tenantId}")

# Or via MCP HTTP API
curl -X POST https://mast-mcp-server-536075659586.us-central1.run.app/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {api-key}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mast_hosting","arguments":{"action":"deploy","tenantId":"{tenantId}"}}}'
```

---

## Post-Setup Checklist

- [ ] Public storefront loads at `https://{domain}`
- [ ] Product catalog page shows (empty is fine)
- [ ] Admin app loads at `https://{domain}/app/`
- [ ] Google Sign-In works in admin app
- [ ] Owner email gets `admin` role after first sign-in
- [ ] Square sandbox checkout flow works
- [ ] Emails send via SendGrid (test with order confirmation)
- [ ] AI features work (studio assistant, shoot cards)
- [ ] Feedback widget appears on public pages
- [ ] `mast_hosting` deploys successfully
