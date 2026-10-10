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
import { AppState } from 'react-native';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider, useAuth } from './src/state/auth';
import { ToastProvider } from './src/components/Toast';
import { MemberActionsProvider } from './src/state/memberActions';
import { SplashScreen } from './src/screens/auth/Splash';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { RootStackParamList } from './src/navigation/types';
import { ApiError } from './src/api/client';

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
        screens: { Flows: 'flows', Crushes: 'crushes', Messages: 'messages', Profile: 'profile' },
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
  const { colors } = useTheme();
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

  const navTheme = {
    ...(colors.scheme === 'light' ? DefaultTheme : DarkTheme),
    colors: {
      ...(colors.scheme === 'light' ? DefaultTheme : DarkTheme).colors,
      background: colors.bg, card: colors.bg, text: colors.text, border: colors.border, primary: colors.gold, notification: colors.crush,
    },
  };

  if (status === 'restoring' || !fontsReady) return <SplashScreen fontsReady={fontsReady && status !== 'restoring'} />;

  return (
    <NavigationContainer theme={navTheme} linking={Platform.OS === 'web' ? undefined : linking} documentTitle={{ formatter: () => 'Crushly' }}>
      <StatusBar style={colors.scheme === 'light' ? 'dark' : 'light'} />
      <MemberActionsProvider>
        <RootNavigator fontsReady={fontsReady} />
      </MemberActionsProvider>
    </NavigationContainer>
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
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
