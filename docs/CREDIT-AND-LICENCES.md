# Crushly — credit and third-party licences

**Official attribution: Odoh chiagoziem isreal.**

This document records who built Crushly and what it is built on. It makes no
legal claim beyond what is written here, and it does not assert ownership of any
third-party component.

---

## 1. Crushly's own credit

| Where | Wording |
|---|---|
| README.md | "Designed and built by Odoh chiagoziem isreal." |
| Terms of Service §20 and Privacy Policy §15 | "Odoh chiagoziem isreal" |
| Credits page (Settings → Support → Credits) | "Odoh chiagoziem isreal" |
| PROJECT_CONTINUITY.md | **Owner:** Odoh chiagoziem isreal |
| CHANGELOG.md | Owner and official credit: **Odoh chiagoziem isreal** |
| Google Drive project library | every document is described with the credit |
| Dropbox project library | credited in this document and in the changelog |
| `src/lib/company.ts` | `APP_AUTHOR = 'Odoh chiagoziem isreal'` |

The string is held in exactly one constant, `APP_AUTHOR`, and rendered from it —
so it cannot drift between screens. The UI copy is `APP_CREDIT_LINE`.

`COMPANY_SITE` is intentionally empty rather than pointing at a placeholder URL;
an empty site value renders no link.

## 2. The product

**Crushly is a product of Riel Inc.** The app states this in the README and in
the Credits page.

## 3. Third-party components

Crushly is built on open-source software. The libraries below are used under
their own licences and remain the property of their authors. Their licence files
ship inside `node_modules` at install time; they are not copied into this repo.

| Component | Role | Licence |
|---|---|---|
| Expo / React Native | app runtime, native modules, build tooling | MIT |
| React | UI | MIT |
| React Navigation | navigation | MIT |
| TanStack Query | server-state cache | MIT |
| Supabase JS | backend client | MIT |
| Supabase (platform) | Postgres, Auth, Storage, RLS | service, Apache-2.0 client |
| Cloudflare Workers | media delivery edge, auth check, range/proxy | service |
| Backblaze B2 | private object storage for all member media | service |
| Cloudflare Wrangler | Worker build/deploy | MIT |
| react-native-svg | vector drawing | MIT |
| expo-image / expo-image-picker / expo-audio / expo-secure-store | media and session primitives | MIT |
| Fraunces | display typeface | SIL Open Font License 1.1 |
| Manrope | body typeface | SIL Open Font License 1.1 |
| `@expo/vector-icons` bundled fonts | iconography | MIT (sets derived from Feather, Ionicons, Material — each MIT) |
| Didit | identity verification (integration) | service |

When adding a dependency, keep its licence file intact and add a row here. Do
not remove or alter a third-party licence header.

## 4. What is *not* claimed

- No claim is made over any font, icon set, or library above.
- No trademark registration is asserted in this document.
- No legal opinion is expressed. Where a licence question matters, read the
  licence text that ships with the package.

## 5. The Crushly mark

The Crushly heart is the project's own mark. It lives at
`CrushlyApp/assets/` and is the only logo the app renders — see
`ICON-AND-RELEASE.md`. Earlier C-monogram artwork was removed from every icon
slot in 1.0.10; it remains in git history only.
