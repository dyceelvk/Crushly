import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ExpoSplash from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useFonts } from 'expo-font';
import { Fraunces_500Medium_Italic, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { NavigationContainer, DarkTheme, DefaultTheme, type LinkingOptions } from '@react-navigation/native';
import { AppState, View } from 'react-native';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider, useAuth } from './src/state/auth';
import { ToastProvider } from './src/components/Toast';
import { UpdateGate } from './src/components/UpdateGate';
import { MemberActionsProvider } from './src/state/memberActions';
import { BootCanvas } from './src/screens/auth/Splash';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { RootStackParamList } from './src/navigation/types';
import { ApiError } from './src/api/client';
import { ErrorBoundary } from './src/components/ErrorBoundary';

ExpoSplash.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// Refetch when the app returns to the foreground (react-query's focus manager is web-only by default).
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
    return () => sub.remove();
  });
}

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['crushly://'],
  config: {
    screens: {
      Welcome: 'welcome',
      SignIn: 'sign-in',
      SignUp: 'join',
      Main: {
        screens: { Flows: 'home', Discover: 'discover', Messages: 'messages', Profile: 'profile' },
      },
      UserProfile: 'u/:id',
      Chat: 'chat/:conversationId',
      Moments: 'moments',
      Notifications: 'notifications',
      Settings: 'settings',
      Verification: 'verification',
      Safety: 'safety',
      Privacy: 'privacy',
      Info: 'info/:page',
    },
  },
};

function Shell() {
  const { status } = useAuth();
  const { colors, ready: themeReady } = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold, Fraunces_500Medium_Italic,
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  const fontsReady = fontsLoaded || !!fontError;
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    // Hand off from the native splash to our animated one as soon as we can draw.
    if (!splashHidden) {
      ExpoSplash.hideAsync().catch(() => {});
      setSplashHidden(true);
    }
  }, [splashHidden]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  // Transparent screen transitions and modals reveal the app canvas beneath
  // them. Keep the browser page itself in the selected scheme too; otherwise
  // the first frame of a fade can expose the browser's default white page.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.backgroundColor = colors.bg;
    root.style.colorScheme = colors.scheme;
    root.dataset.crushlyScheme = colors.scheme;
    document.body.style.backgroundColor = colors.bg;
    document.body.style.color = colors.text;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', colors.bg);
  }, [colors.bg, colors.scheme, colors.text]);

  const navTheme = {
    ...(colors.scheme === 'light' ? DefaultTheme : DarkTheme),
    colors: {
      ...(colors.scheme === 'light' ? DefaultTheme : DarkTheme).colors,
      background: colors.bg, card: colors.bg, text: colors.text, border: colors.border, primary: colors.gold, notification: colors.crush,
    },
  };

  if (status === 'restoring' || !fontsReady || !themeReady) return <BootCanvas />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <NavigationContainer theme={navTheme} linking={Platform.OS === 'web' ? undefined : linking} documentTitle={{ formatter: () => 'Crushly' }}>
        <StatusBar style={colors.scheme === 'light' ? 'dark' : 'light'} />
        <MemberActionsProvider>
          {/* A render error unmounts the tree and leaves a white page. The boundary
              makes that a sentence and a "Try again" instead. */}
          <ErrorBoundary>
            <RootNavigator fontsReady={fontsReady} />
          </ErrorBoundary>
        </MemberActionsProvider>
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <Shell />
              {/* Offered above the app rather than inside a screen: an update is
                  not a settings-page event, and a member who never opens
                  Settings would never hear about one. */}
              <UpdateGate />
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
