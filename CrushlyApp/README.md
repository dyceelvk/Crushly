# Crushly app

Expo (SDK 57) and React Native 0.86, written in TypeScript. The same codebase runs on iOS, Android and web. See the [root README](../README.md) for setup, the demo account and feature status.

```bash
npm install
cp .env.example .env       # Supabase URL + anon key (see supabase/README.md)
npm start                  # Expo dev server
npm run typecheck
npm run build:web          # static web build in dist/ — this is what Netlify publishes
```

## Structure

```
src/
  theme/        tokens.ts (colours, spacing, radii, type scale) + ThemeProvider (dark / light / system, reduced motion)
  components/   design system: Txt, Button, IconButton, Input, Chip, Toggle, Slider, Segmented,
                ListRow/Group, Sheet, Toast, Photo/Avatar, Badges, CrushButton, ProfileCard,
                PhotoGrid, MessageBubble, States (loading / empty / error), Logo
  api/          client.ts (Supabase client, ApiError, media URLs, uploads), service.ts (typed
                data layer over Auth/Postgres/Storage), types.ts, hooks.ts (react-query)
  state/        auth.tsx (Supabase Auth session), memberActions.tsx (shared block / report / share sheet)
  navigation/   RootNavigator (auth → onboarding → app), custom TabBar, route types
  screens/      auth, onboarding, discover, crushes, messages, moments, profile,
                notifications, settings (Settings, Safety, Verification, Plus, Info)
  lib/          storage (SecureStore / localStorage), haptics, media (pick + resize), format, catalog
```

## Deploying

- **Web**: Netlify builds this folder via the root `netlify.toml`
  (`npm run build:web` → `dist/`). Set `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the Netlify environment.
- **iOS / Android**: `eas.json` is set up (development / preview / production
  builds). Set the same two env vars before `eas build` (or bake them into a CI
  secret). Everything else is standard Expo.

Tests: `npm test` runs the unit tests (format helpers, message previews, Moments
feed grouping); `npm run typecheck` is the type gate. Both run in CI.

## Design rules

- **Palette**: background `#070708`, cards `#17171A`, gold `#D8B46A` for brand and selection, crush `#FF496C` *only* for the Crush action and Mutual Crush moments. Every colour comes from `theme/tokens.ts`, so light mode is automatic.
- **Type**: Fraunces (display headings only) and Manrope (everything else). Text scales with the system font size, capped at 1.5×.
- **Words**: Crush, never "like". Mutual Crush, never "match". Discover, never "swipe". Connections, Discoveries, Deep Crush.
- **Restraint**: one ambient glow per screen at most, short animations, and every animation is skipped when the OS "reduce motion" setting is on.
- **Accessibility**: 44pt minimum touch targets, labels on every icon button, and status is never shown by colour alone (online = dot + "Online now"; verified = badge + label for screen readers).
- **Privacy**: exact location never leaves the device unrounded. The UI shows only approximate distance or city.
