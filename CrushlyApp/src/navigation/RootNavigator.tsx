import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { browserLocation } from '../lib/browser';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { isVerificationReturn } from '../lib/verification';
import { useAuth } from '../state/auth';
import { useTheme } from '../theme/ThemeProvider';
import { useBadges } from '../api/hooks';
import { useToast } from '../components/Toast';
import { TabBar } from './TabBar';
import type { RootStackParamList, TabParamList } from './types';
import { notificationText } from '../screens/notifications/Notifications';

import { SplashScreen } from '../screens/auth/Splash';
import { WelcomeScreen } from '../screens/auth/Welcome';
import { SignInScreen, SignUpScreen, ForgotPasswordScreen, SetPasswordScreen } from '../screens/auth/AuthForms';
import {
  OnboardingAboutScreen, OnboardingBasicsScreen, OnboardingIntentionsScreen, OnboardingPhotosScreen, OnboardingPreferencesScreen,
} from '../screens/onboarding/Onboarding';
import { DiscoverScreen } from '../screens/discover/Discover';
import { SearchScreen } from '../screens/discover/Search';
import { FlowScreen } from '../screens/flow/Flow';
import { FiltersScreen } from '../screens/discover/Filters';
import { CrushesScreen } from '../screens/crushes/Crushes';
import { MutualCrushScreen, celebrated } from '../screens/crushes/MutualCrush';
import { MessagesScreen } from '../screens/messages/Messages';
import { ChatScreen } from '../screens/messages/Chat';
import { MomentsScreen } from '../screens/moments/Moments';
import { MomentViewerScreen } from '../screens/moments/MomentViewer';
import { VibeViewerScreen } from '../screens/discover/VibeViewer';
import { MomentComposerScreen } from '../screens/moments/MomentComposer';
import { ProfileTabScreen } from '../screens/profile/ProfileTab';
import { CirclesScreen } from '../screens/circles/Circles';
import { CircleScreen } from '../screens/circles/Circle';
import { CloseOnesScreen } from '../screens/circles/CloseOnes';
import { UserProfileScreen } from '../screens/profile/UserProfile';
import { EditProfileScreen } from '../screens/profile/EditProfile';
import { NotificationsScreen } from '../screens/notifications/Notifications';
import { AccountScreen, AppearanceScreen, BlockedUsersScreen, NotificationSettingsScreen, SettingsScreen } from '../screens/settings/Settings';
import { SafetyScreen, PrivacyScreen } from '../screens/settings/Safety';
import { VerificationScreen } from '../screens/settings/Verification';
import { PlusScreen } from '../screens/settings/Plus';
import { InfoScreen } from '../screens/settings/Info';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();
// Capture before navigation/auth restoration can normalize the browser URL.
const landingLocation = browserLocation(Platform.OS, typeof window === 'undefined' ? undefined : window);
const verificationLanding = !!landingLocation &&
  (landingLocation.pathname === '/verification' || isVerificationReturn(landingLocation.search ?? ''));

/** Surfaces new notifications as a quiet toast while the app is open (polling-based). */
function LiveNotifications() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data } = useBadges(true);
  const toast = useToast();
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    const n = data?.latestNotification;
    if (!n) return;
    if (lastId.current === null) {
      lastId.current = n.id; // don't replay what was there before this session
      return;
    }
    if (n.id === lastId.current) return;
    lastId.current = n.id;
    if (n.kind === 'message') return; // messages surface as the tab badge
    if (n.kind === 'mutual' && n.actor_id && celebrated.has(n.actor_id)) return; // already saw the Mutual Crush screen
    const t = notificationText({ kind: n.kind, body: n.body, actor: n.actor_name ? { name: n.actor_name } : null });
    toast({
      kind: n.kind === 'crush' || n.kind === 'deep_crush' || n.kind === 'mutual' ? 'crush' : 'info',
      title: t.title,
      message: t.detail,
      onPress: () => navigation.navigate('Notifications'),
    });
  }, [data?.latestNotification, toast, navigation]);
  return null;
}

function MainTabs() {
  return (
    <>
      <LiveNotifications />
      <Tabs.Navigator tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, lazy: true }}>
        <Tabs.Screen name="Flows" component={FlowScreen} />
        <Tabs.Screen name="Crushes" component={CrushesScreen} />
        <Tabs.Screen name="Messages" component={MessagesScreen} options={{ title: 'Whispers' }} />
        <Tabs.Screen name="Profile" component={ProfileTabScreen} options={{ title: 'Space' }} />
      </Tabs.Navigator>
    </>
  );
}

export function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth();
  const { colors, reduceMotion } = useTheme();

  if (status === 'restoring' || !fontsReady) return <SplashScreen fontsReady={fontsReady && status !== 'restoring'} />;

  return (
    <Stack.Navigator
      initialRouteName={status === 'ready' && verificationLanding ? 'Verification' : undefined}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: reduceMotion ? 'none' : 'slide_from_right',
        animationDuration: 260,
      }}
    >
      {status === 'signedOut' ? (
        <Stack.Group screenOptions={{ animation: reduceMotion ? 'none' : 'fade' }}>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="SignIn" component={SignInScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
          <Stack.Screen name="SignUp" component={SignUpScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
          <Stack.Screen name="Info" component={InfoScreen} />
        </Stack.Group>
      ) : status === 'resetting' ? (
        <Stack.Group screenOptions={{ animation: reduceMotion ? 'none' : 'fade' }}>
          <Stack.Screen name="SetPassword" component={SetPasswordScreen} />
        </Stack.Group>
      ) : status === 'onboarding' ? (
        <Stack.Group>
          <Stack.Screen name="OnboardingIntentions" component={OnboardingIntentionsScreen} />
          <Stack.Screen name="OnboardingBasics" component={OnboardingBasicsScreen} />
          <Stack.Screen name="OnboardingPhotos" component={OnboardingPhotosScreen} />
          <Stack.Screen name="OnboardingAbout" component={OnboardingAboutScreen} />
          <Stack.Screen name="OnboardingPreferences" component={OnboardingPreferencesScreen} />
          <Stack.Screen name="Info" component={InfoScreen} />
        </Stack.Group>
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ animation: 'fade' }} />
          <Stack.Screen name="VibeViewer" component={VibeViewerScreen} options={{ animation: reduceMotion ? 'none' : 'fade' }} />
          <Stack.Screen name="UserProfile" component={UserProfileScreen} />
          <Stack.Screen name="Moments" component={MomentsScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="Discover" component={DiscoverScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="Search" component={SearchScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
          <Stack.Screen name="Circles" component={CirclesScreen} />
          <Stack.Screen name="Circle" component={CircleScreen} />
          <Stack.Screen name="CloseOnes" component={CloseOnesScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          <Stack.Screen name="Verification" component={VerificationScreen} />
          <Stack.Screen name="Safety" component={SafetyScreen} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} />
          <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
          <Stack.Screen name="Account" component={AccountScreen} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
          <Stack.Screen name="Appearance" component={AppearanceScreen} />
          <Stack.Screen name="Info" component={InfoScreen} />
          <Stack.Group screenOptions={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'slide_from_bottom' }}>
            <Stack.Screen name="Filters" component={FiltersScreen} />
            <Stack.Screen name="MomentComposer" component={MomentComposerScreen} />
            <Stack.Screen name="Plus" component={PlusScreen} />
          </Stack.Group>
          <Stack.Group screenOptions={{ presentation: 'transparentModal', animation: reduceMotion ? 'none' : 'fade', contentStyle: { backgroundColor: 'transparent' } }}>
            <Stack.Screen name="MutualCrush" component={MutualCrushScreen} />
            <Stack.Screen name="MomentViewer" component={MomentViewerScreen} options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: '#000' } }} />
          </Stack.Group>
        </>
      )}
    </Stack.Navigator>
  );
}
