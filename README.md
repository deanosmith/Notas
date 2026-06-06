# Notas

## Firebase Config

Hosted GitHub Pages builds generate `firebase-config.js` from repository secrets during the Actions deploy. The deployed app reads only that generated file; Firebase values are not committed to `index.html`.

Required repository secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MEASUREMENT_ID`

The deploy workflow validates that these secrets are present and shaped like Firebase web app values before publishing GitHub Pages. If a secret is missing or placed under the wrong name, deployment fails instead of publishing a broken login page.

For local development, use `.env` directly through the local server:

```sh
cp .env.example .env
# Fill .env with the local Firebase app values.
node scripts/serve-local.mjs
```

Then open:

http://127.0.0.1:8000/

The local server reads `.env` on each request and serves a generated `/firebase-config.js` matching the production file. The `.env` file is ignored by git and is never served as a static file.
