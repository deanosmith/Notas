# Notas

## Firebase Config

Hosted GitHub Pages builds generate `firebase-config.local.js` from repository secrets during the Actions deploy. The deployed app reads that generated file; Firebase values are not committed to `index.html`.

Required repository secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MEASUREMENT_ID`

The deploy workflow checks that these secrets are present before publishing GitHub Pages. There is no separate local Firebase config path.
