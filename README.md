# Notas

## Firebase Config

Hosted GitHub Pages builds inject Firebase values into `index.html` from repository secrets.

Required hosted secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`

Optional hosted secrets:

- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_MEASUREMENT_ID`

For local development, use `.env` directly through the local server:

```sh
cp .env.example .env
# Fill .env with the local Firebase app values.
node scripts/serve-local.mjs
```

Then open:

http://127.0.0.1:8000/

The local server reads `.env` on each page request and injects only the Firebase browser config values into `index.html`. The `.env` file is ignored by git and is never served as a static file.
