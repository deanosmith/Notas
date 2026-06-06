# Notas

## Firebase Config

Hosted GitHub Pages builds inject Firebase values into `index.html` from repository secrets. Hosted URLs use those injected values only; they do not load `firebase-config.local.js`.

Required hosted secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`

Optional hosted secrets:

- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_MEASUREMENT_ID`

For local development, create a local config file from `.env`:

```sh
cp .env.example .env
# Fill .env with the local Firebase app values.
node scripts/write-local-firebase-config.mjs
```

Then serve the directory locally, for example:

```sh
python3 -m http.server 8000
```

The generated `firebase-config.local.js` and `.env` files are ignored by git.
