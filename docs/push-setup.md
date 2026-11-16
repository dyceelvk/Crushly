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
| App registration + sign-out cleanup | `src/lib/push.ts` | shipped in 1.0.125 with `google-services.json` in the build |
| FCM service account | `push_config.fcm_service_account` (service-role only) | installed, credential proven |
| Per-sound Android channels (`holup-alerts-<sound>`) | app + function | shipped |

Proven with a deliberately fake device token, so the only variable was the
credential. Attempt #2 logged `sent=0 failed=0` with **no error note**, which is
only possible if Google issued an access token and FCM answered the send; the fake
token was then removed by the dead-token path. Earlier, the same chain without the
credential logged `note="FCM service account not configured"`.

## Still needed

A real device token — i.e. the app installed and signed in on a phone. Until
`device_tokens` has a row, every send is correctly logged as `no registered
devices`.

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
