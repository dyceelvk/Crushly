# Crushly

A premium dating and social app for gay, bi and queer men. *Meet men. Make connections. Follow the feeling.*

This repository has two parts:

| Folder | What it is |
| --- | --- |
| [`CrushlyApp/`](CrushlyApp/) | The app. Expo (React Native) for iOS, Android and web, written in TypeScript. |
| [`server/`](server/) | The API. Node 22+, Express 5 and built-in SQLite (`node:sqlite`), with no other database to install. |

## Run it locally

Requires **Node 22.13 or newer**.

```bash
# 1. API server, seeded with demo members (port 3000)
cd server
npm install
CRUSHLY_SEED=1 npm start

# 2. App (in another terminal)
cd CrushlyApp
npm install
npm start          # Expo dev server: press i / a, or scan the QR code with Expo Go
```

To get a single URL with no Expo dev server, build the web app once (`npm run build:web` in `CrushlyApp/`). The API serves `CrushlyApp/dist` automatically, so open <http://localhost:3000>.

On a physical phone, the app looks for the API on the same machine as Metro, port 3000. If your API runs somewhere else, set `EXPO_PUBLIC_API_URL=https://your-api.example.com` before `npm start`.

### Demo account

Sign in with **daniel@crushly.app / crushly123**, or tap *Explore the demo community* on the sign-in screen. Every seeded member is a real account with the password `crushly123`, so you can sign in as anyone in a second browser and test both sides of a Crush or a conversation. For example, crush back on **Marcus** from Daniel's account to see a Mutual Crush.

Reset the demo data at any time with `cd server && npm run seed -- --reset`.

## What works end to end

Everything below is backed by the API and stored in SQLite:

- Sign up, sign in, sign out, change email or password, sign out other sessions, pause account, delete account
- Onboarding: intentions, basics, photo upload (resized on device), bio, interests, and discovery preferences
- Discover with filters (age, distance, connection type, interests). Distance is always rounded and exact location is never returned.
- Crush, Deep Crush with a note, Pass, Mutual Crush celebration, and removing a Connection
- Crushes: *Crushing on you* / *Your crushes* / *Mutual Crushes*
- Messaging: text, photos, voice notes, stickers, shared profiles, Crush reactions, optional read receipts, and new messages within ~3 seconds
- Moments (expire after 24h): text or photo, viewer with reply, react and Crush
- Notification center with live in-app toasts
- Safety: block, unblock, report (from profiles, chats and Moments), hide from Discover, who can message or Crush you, show or hide online status, distance, age and read receipts
- Verification: selfie with a random pose. Requests stay **pending** until a moderator approves them.
- Settings: discovery, privacy, notifications, dark/light/system appearance, and support pages

## Deliberately not faked

These features need a third-party service or a human in the loop. Rather than pretend, the UI says so honestly:

| Feature | Status |
| --- | --- |
| **Crushly Plus** | The paywall screen records interest (`POST /api/me/plus-interest`). There's no payment provider yet, so nothing is charged and no Plus features unlock. Incognito returns `402 plus_required`. |
| **Verification review** | Selfies are stored privately in `server/data/private/`. Approve them with `npm run verify-user -- approve <email>`. |
| **Reports** | Stored and listed with `npm run reports`. There's no moderator dashboard yet. |
| **Push notifications** | In-app notifications and toasts work. OS push needs Expo push credentials and isn't wired up yet. |
| **GIFs** | Replaced by a built-in sticker pack, so no GIF API key is needed. |
| **Realtime** | Polling through react-query (a few seconds in an open chat). Replace with WebSockets when you scale. |

## Before launch

- The **Terms, Privacy and Community Guidelines** copy in `CrushlyApp/src/screens/settings/Info.tsx` is placeholder text written for the product. Have it reviewed by a lawyer.
- The seed uses 10 AI-generated portraits (`server/seed/photos/`) for demo members. Don't ship them as real users.
- Set up HTTPS, back up `server/data/`, and run the API behind a reverse proxy.

## Tests

```bash
cd server && npm test          # API integration tests (node:test)
cd CrushlyApp && npm run typecheck
```
