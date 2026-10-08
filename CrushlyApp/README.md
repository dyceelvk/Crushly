# Crushly – React Native App UI

Complete UI implementation of the **Crushly** dating/social app based on the provided mockups.

## Features

- Custom gold SVG logo
- Dark premium theme (black + gold + hot pink)
- Splash screen
- Onboarding flow (Welcome → Looking For → Profile Setup)
- Main tab navigation (Discover, Crushes, Messages, Moments, Profile)
- Mutual Crush screen
- Chat screen
- Premium / Plus screen
- Settings, Safety Center, Filters

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. For iOS
cd ios && pod install && cd ..
npx react-native run-ios

# 3. For Android
npx react-native run-android
```

## Required Dependencies

Already listed in `package.json`:

- `@react-navigation/native`
- `@react-navigation/native-stack`
- `@react-navigation/bottom-tabs`
- `react-native-screens`
- `react-native-safe-area-context`
- `react-native-svg`
- `react-native-vector-icons`

## Logo

The logo is a pure SVG component (`CrushlyLogo`) – no external image assets needed.

## Notes

- Placeholder images use Unsplash URLs (internet required).
- Replace with your own assets or local images for production.
- This is a UI-only prototype – no backend / real auth / matching logic included.

Enjoy building Crushly! ❤️
