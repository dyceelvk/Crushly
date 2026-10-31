/**
 * Render harness — never shipped, never committed to the app repo.
 *
 * Mounts one screen at a time, outside the real navigator and with a seeded
 * query cache, so a screen that normally sits behind a signed-in session (with a
 * real Supabase project behind it) can still be rendered and screenshotted.
 * The screen is chosen with `?s=<name>`.
 *
 * It lives in the workspace (/home/user/harness) rather than /tmp because /tmp
 * does not survive between sessions and this file has had to be rewritten twice.
 */
import React from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import { Fraunces_500Medium_Italic, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { AuthProvider, useAuth } from '../src/state/auth';
import { ToastProvider } from '../src/components/Toast';
import { MemberActionsProvider } from '../src/state/memberActions';
import { mockEntries } from './mocks';

import {
  OnboardingIntentionsScreen,
  OnboardingBasicsScreen,
  OnboardingPhotosScreen,
  OnboardingAboutScreen,
  OnboardingPreferencesScreen,
} from '../src/screens/onboarding/Onboarding';
import { FlowScreen } from '../src/screens/flow/Flow';
import { PostViewerScreen } from '../src/screens/flow/PostViewer';
import { ProfileTabScreen } from '../src/screens/profile/ProfileTab';
import { EditProfileScreen } from '../src/screens/profile/EditProfile';
import { UserProfileScreen } from '../src/screens/profile/UserProfile';
import { MessagesScreen } from '../src/screens/messages/Messages';
import { ChatScreen } from '../src/screens/messages/Chat';
import { SettingsScreen } from '../src/screens/settings/Settings';

const nav = {
  navigate: () => {},
  goBack: () => {},
  replace: () => {},
  push: () => {},
  reset: () => {},
  setOptions: () => {},
  addListener: () => () => {},
  canGoBack: () => true,
  dispatch: () => {},
} as any;

const SCREENS: Record<string, (p: any) => React.ReactElement> = {
  flow: FlowScreen,
  profile: ProfileTabScreen,
  edit: EditProfileScreen,
  user: (p: any) => <UserProfileScreen route={{ key: 'u', name: 'UserProfile', params: { id: 2 } } as any} navigation={p.navigation} />,
  messages: MessagesScreen,
  chat: ChatScreen,
  settings: SettingsScreen,
  viewer: (p: any) => <PostViewerScreen route={{ key: 'v', name: 'PostViewer', params: { postId: 102 } } as any} navigation={p.navigation} />,
  viewerportrait: (p: any) => <PostViewerScreen route={{ key: 'v', name: 'PostViewer', params: { postId: 103 } } as any} navigation={p.navigation} />,
  intentions: OnboardingIntentionsScreen,
  basics: OnboardingBasicsScreen,
  photos: OnboardingPhotosScreen,
  about: OnboardingAboutScreen,
  preferences: OnboardingPreferencesScreen,
};

const pick = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('s') || 'flow' : 'flow';
const chosen = SCREENS[pick] || SCREENS.flow;

// Seed every query the screens read before anything mounts.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false } },
});
for (const [key, value] of mockEntries) {
  queryClient.setQueryData(key, value);
}

function Inner() {
  const { status } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold, Fraunces_500Medium_Italic,
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  const ready = fontsLoaded || !!fontError;
  const Screen = chosen;
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0A0E27' }} />;
  return (
    <View style={{ flex: 1 }} testID={`harness-${status}`}>
      <Screen navigation={nav} route={{ key: 'h', name: pick, params: {} }} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <MemberActionsProvider>
                <NavigationContainer>
                  <Inner />
                </NavigationContainer>
              </MemberActionsProvider>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
