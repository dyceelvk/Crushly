# Turning on real push for holUpp

Everything on the holUpp side is built and deployed. What is missing is the Google
side — a Firebase project — because only Google can wake a phone that is not
running the app, and only the project owner can create those credentials.

## What already exists (done, verified)

| Piece | Where | State |
|---|---|---|
| `device_tokens`, `push_attempts`, `push_config` tables | live database | applied |
| `register_device_token` / `set_device_sound` / `unregister_device_token` | live database | applied, authenticated only |
| Trigger on `notifications` and `messages` | live database | fires, proven by a real insert |
| `push-dispatch` edge function | `…/functions/v1/push-dispatch` | deployed, rejects anonymous callers with 401 |
| App registration + sign-out cleanup | `src/lib/push.ts` | shipped in 1.0.124 (inert until Firebase exists) |
| Per-sound Android channels (`holup-alerts-<sound>`) | app + function | shipped |

A real insert into `notifications` produced this row, which is the chain working:

```
source=notifications record_id=200 sent=0 failed=0
note="FCM service account not configured"
```

## What you need to do — about three minutes

1. Open <https://console.firebase.google.com> and **Add project** (you can reuse the
   existing Google Cloud project `234301766260` if you prefer). Name it `holupp`.
2. In the project: **Add app → Android**. Package name must be exactly
   **`app.holup.mobile`**. Download **`google-services.json`**.
3. **Project settings → Service accounts → Generate new private key**. Download that
   JSON too.

Then paste me the contents of both files. I will:

- add `google-services.json` to `CrushlyApp/` (the build picks it up automatically —
  `app.config.js` only wires Firebase in when the file is present, so builds never
  break while it is missing);
- set the service account JSON as the edge function secret `FCM_SERVICE_ACCOUNT`;
- build and publish the next version, then prove it with a real push to your phone.

## Why not Expo's push service

Expo's own service also terminates at Firebase for Android, so it would not avoid
these two files — it would only add a third party that knows holUpp's notification
contents. The app talks to FCM directly instead.

## What the member sees

- **App open:** chime and banner at once (10-second poll, already live).
- **App closed:** a real push from Google, with the member's chosen sound, because
  each choice has its own Android channel.
- **Never:** your own actions, a muted category in Notification settings, or a
  message you are already reading.
