# Whistle Connect

A Chrome extension that syncs your personal LinkedIn 1st-degree connections to your
Whistle workspace, so you can see "you know N people here" warm paths into NCAA
athletic departments.

Forked from the open-source GTMBase LinkedIn Sync extension. All third-party
analytics endpoints have been removed — connections are sent only to your Whistle
instance using your per-user API key. The Whistle workspace URL is baked into the
zip at download time, so the extension is locked to the workspace that issued it.

## Install

1. In Whistle, open **Settings → Whistle Connect** and download `whistle-connect.zip`.
2. Unzip the file.
3. Open Chrome and navigate to `chrome://extensions/`.
4. Toggle **Developer mode** on (top right).
5. Click **Load unpacked** and select the unzipped folder.

## Configure

1. In Whistle, open **Settings → Whistle Connect** and click **Create API key**.
   Copy the key — it is shown only once.
2. Click the Whistle Connect extension icon in Chrome.
3. Paste the API key into the **Whistle API Key** field.
4. Click **Sync Connections**.

There is no URL field — the extension always talks to the Whistle workspace it
was downloaded from.

The extension sends batches to `POST /api/v1/linkedin/connections` with
`Authorization: Bearer <api-key>`. Connections are deduped on `(user, entityUrn)`
and re-syncs only emit signals for newly-matched staff. Use **Resync all** in
Settings → Whistle Connect to force the next extension run to re-fetch every
connection (delta off for one run).

## Privacy

Your synced LinkedIn connections are scoped to your Whistle account — no other
Whistle user can see them. Connection data is stored only in your Whistle
workspace's database. You are responsible for using Whistle Connect in
compliance with the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement).
Revoke your API key any time in Settings → Whistle Connect to stop ingestion.
