# Deployment, access and maintenance

Repository: https://github.com/shumsularefin/AICHE-GSTU
Planned address: https://aiche-gstu.web.app (set when the Firebase project is created; see step 3 below).

The website runs on the free Firebase **Spark** plan: static Hosting, Google sign-in and Firestore. No Cloud Functions, Cloud Storage or billing account is needed.

## Current state

The repository is complete, but **no Firebase project is connected yet**:

- `data/site-config.json` has no API key, so the public pages show the built-in starter content and the Chapter Editor explains that sign-in is turned off.
- The GitHub workflow runs every check on each push and pull request, but **skips deployment** until the repository variables below exist.
- To see the site now: `npm ci`, `npm run build:seed`, `npm run preview`, then open http://127.0.0.1:4173.

## Connecting Firebase (one time)

You need the Google account that will own the project and owner access to this GitHub repository.

### 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project**. Name it, for example, `aiche-gstu`. Note the **project ID** (it may get a suffix such as `aiche-gstu-1a2b3` if the name is taken). Google Analytics is not needed.
2. **Build → Firestore Database → Create database.** Choose production mode and a location near Bangladesh (for example `asia-south1`).
3. **Build → Authentication → Get started → Sign-in method → Google → Enable.** Under **Settings → Authorized domains**, make sure `<project-id>.web.app` and `<project-id>.firebaseapp.com` are listed.
4. **Build → Hosting → Get started** (you can skip the CLI steps shown; the workflow deploys).
5. **Project settings → General → Your apps → Web app (</>)**. Register an app (no Hosting setup needed) and copy `apiKey`, `authDomain` and `projectId`.

### 2. Put the project settings in the code

| File | Change |
| --- | --- |
| `data/site-config.json` | Set `cloudEnabled` to `true` and fill in `apiKey`, `authDomain` and `projectId`. These values are public by design; Firestore rules protect the data. |
| `.firebaserc` | Set `default` to the project ID. |
| `js/lib/site-identity.js` | Set `SITE_ORIGIN` to `https://<project-id>.web.app` (or your custom domain). QR codes, share links, the sitemap and calendar files use it. |
| `firebase.json` | In the Content-Security-Policy `frame-src`, replace `aiche-gstu.firebaseapp.com` and `aiche-gstu.web.app` with your project's addresses. |
| `firestore.rules` | `isOwner()` names the permanent super-admin (`muhammadshamsularefin01@gmail.com`). Change it here and in `SUPER_ADMIN_EMAIL` (`js/admin/cloud.js`) if a different account should own the dashboard. |

Commit and push these changes.

### 3. Let GitHub deploy without storing a key

The workflow signs in to Google Cloud with short-lived credentials (Workload Identity Federation), so no service-account key is ever stored in GitHub.

In https://console.cloud.google.com (same project), open **Cloud Shell** and run, replacing `PROJECT_ID`:

```sh
PROJECT_ID=PROJECT_ID
REPO=shumsularefin/AICHE-GSTU
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud config set project $PROJECT_ID
gcloud services enable iamcredentials.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com

# Identity pool that trusts this GitHub repository only
gcloud iam workload-identity-pools create github-deploy --location=global --display-name="GitHub deploy"
gcloud iam workload-identity-pools providers create-oidc github-repository --location=global \
  --workload-identity-pool=github-deploy --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository=='$REPO'"

# One account that can deploy Hosting, one that can only change security rules
gcloud iam service-accounts create github-hosting --display-name="GitHub Hosting deploy"
gcloud iam service-accounts create github-rules --display-name="GitHub rules deploy"
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:github-hosting@$PROJECT_ID.iam.gserviceaccount.com --role=roles/firebasehosting.admin
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:github-hosting@$PROJECT_ID.iam.gserviceaccount.com --role=roles/serviceusage.serviceUsageConsumer
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:github-rules@$PROJECT_ID.iam.gserviceaccount.com --role=roles/firebaserules.admin
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:github-rules@$PROJECT_ID.iam.gserviceaccount.com --role=roles/serviceusage.serviceUsageConsumer
for SA in github-hosting github-rules; do
  gcloud iam service-accounts add-iam-policy-binding $SA@$PROJECT_ID.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-deploy/attribute.repository/$REPO"
done
echo "Provider: projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-deploy/providers/github-repository"
```

Then in GitHub → **Settings → Secrets and variables → Actions → Variables**, add:

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | the project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | the "Provider" line printed above |
| `GCP_HOSTING_SERVICE_ACCOUNT` | `github-hosting@PROJECT_ID.iam.gserviceaccount.com` |
| `GCP_RULES_SERVICE_ACCOUNT` | `github-rules@PROJECT_ID.iam.gserviceaccount.com` |
| `CONTENT_SOURCE` | `auto` (first deploy only; delete it once the dashboard has published content) |

Under **Settings → Environments**, create `firestore-rules` and add yourself as a required reviewer.

### 4. First deploy

1. **Actions → Deploy Firestore security rules → Run workflow**, then approve it. (Alternatively, from a computer with the Firebase CLI: `npx firebase deploy --only firestore:rules --project PROJECT_ID`.)
2. **Actions → Website checks and Firebase deployment → Run workflow.** The site goes live at `https://<project-id>.web.app` with the starter content.
3. Sign in at `/admin.html` with the owner account and click **Set up storage**. This writes the starter content (founding members, the charter event, membership text) to Firestore.
4. Publish your first changes, then delete the `CONTENT_SOURCE` variable so later builds always read Firestore.

## What happens automatically (once connected)

| Event | Workflow | Result |
| --- | --- | --- |
| Pull request to `main` | Website checks | Unit, site, security-rules and end-to-end tests. Nothing is deployed. |
| Push to `main` | Website checks → deploy | After all checks pass, the site is built from the published Firestore content and deployed to Hosting. |
| Every 15 minutes | Freshness → deploy | When editors published something since the last deploy, the site is rebuilt and redeployed. |
| Manual (Actions tab) | Deploy Firestore security rules | Runs the rules tests, waits for approval, then deploys `firestore.rules` only. |

GitHub pauses scheduled workflows in public repositories after 60 days without commits. If search engines stop picking up published changes, re-enable the workflow in the Actions tab. Visitors always see published changes right away.

## Editor access

The super-admin manages access in **Manage editors & activity**. Enter a Google account email, choose a role, and save. Disable or remove access when a term ends; the activity log keeps the history.

| Role | Can do |
| --- | --- |
| Super-admin | Everything: content, committees and rosters, all certificates, revocation, Certificate Center list, editors, activity log, backups |
| Chapter administrator | Events (any), annual reports, homepage images, membership information, certificates except executive recognition |
| Outreach editor | Homepage images, membership information, add events and edit their own, annual reports, participant certificates |

The owner account in `firestore.rules` is the permanent super-admin and cannot be changed or removed from the dashboard. Only Google sign-in is accepted; the rules check this on the server.

## Developer access

GitHub collaborators are separate from dashboard editors. Add developers in GitHub → Settings → Collaborators. Ask them to work on branches and open pull requests; a merge to `main` deploys.

## Free-tier limits (Spark plan)

Firestore allows 50,000 reads and 20,000 writes per day for free. A visitor usually costs one read every five minutes (the freshness check). Uploaded images are baked into the site, so they cost nothing after the next build. Each uploaded image is stored at up to about 280 KB.

## Backups and rollback

- Content backups: Chapter Editor → Backups → Download backup. This includes private membership IDs, so keep it private and never commit it.
- Restoring a backup loads it into drafts for review; nothing goes live until it is published.
- Hosting rollback: Firebase Console → Hosting → Release history → Roll back. This restores the website files only, not Firestore content.
- Certificates are never deleted. Revocation is permanent and shown on the verification page.
