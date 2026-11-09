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
import { AdminScreen } from '../screens/settings/Admin';
import { Announcement } from '../components/Announcement';
import { View } from 'react-native';
import type { RootStackParamList, TabParamList } from './types';
import { notificationText } from '../screens/notifications/Notifications';

import { BootCanvas } from '../screens/auth/Splash';
import { FollowScreen } from '../screens/auth/Follow';
import { WelcomeScreen } from '../screens/auth/Welcome';
import { SignInScreen, SignUpScreen, ForgotPasswordScreen, SetPasswordScreen } from '../screens/auth/AuthForms';
import {
  OnboardingAboutScreen, OnboardingBasicsScreen, OnboardingIntentionsScreen, OnboardingPhotosScreen, OnboardingPreferencesScreen,
} from '../screens/onboarding/Onboarding';
import { SearchScreen } from '../screens/discover/Search';
import { FeedScreen } from '../screens/flow/FeedScreen';
import { FiltersScreen } from '../screens/discover/Filters';
import { DiscoverTabScreen } from '../screens/discover/DiscoverTab';
import { CrushesScreen } from '../screens/crushes/Crushes';
import { MessagesScreen } from '../screens/messages/Messages';
import { ChatScreen } from '../screens/messages/Chat';
import { MomentsScreen } from '../screens/moments/Moments';
import { MomentViewerScreen } from '../screens/moments/MomentViewer';
import { PostViewerScreen } from '../screens/flow/PostViewer';
import { SavedPostsScreen } from '../screens/flow/SavedPosts';
import { SoundScreen } from '../screens/flow/SoundScreen';
import { MomentComposerScreen } from '../screens/moments/MomentComposer';
import { VideoTrimScreen } from '../screens/common/VideoTrimScreen';
import { CreatePostScreen } from '../screens/common/CreatePostScreen';
import { WebPreviewScreen } from '../screens/common/WebPreview';
import { ProfileTabScreen } from '../screens/profile/ProfileTab';
import { CirclesScreen } from '../screens/circles/Circles';
import { CircleScreen } from '../screens/circles/Circle';
import { CirclePreviewScreen } from '../screens/circles/CirclePreview';
import { CircleManageScreen } from '../screens/circles/CircleManage';
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

/** A quiet toast for new activity; the bell opens the full notifications page. */
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={{ flex: 1 }}>
      <LiveNotifications />
      <Announcement>
      <Tabs.Navigator
        tabBar={(props) => <TabBar {...props} onCreate={() => navigation.navigate('CreatePost')} />}
        screenOptions={{ headerShown: false, lazy: true }}
      >
        <Tabs.Screen name="Flows" component={FeedScreen} options={{ title: 'Home' }} />
        <Tabs.Screen name="Discover" component={DiscoverTabScreen} options={{ title: 'Discover' }} />
        <Tabs.Screen name="Messages" component={MessagesScreen} options={{ title: 'Whispers' }} />
        <Tabs.Screen name="Profile" component={ProfileTabScreen} options={{ title: 'Space' }} />
      </Tabs.Navigator>
      </Announcement>
    </View>
  );
}

export function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth();
  const { colors, reduceMotion } = useTheme();

  if (status === 'restoring' || !fontsReady) return <BootCanvas />;

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
          <Stack.Screen name="Follow" component={FollowScreen} />
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
          <Stack.Screen name="WebPreview" component={WebPreviewScreen} options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="PostViewer" component={PostViewerScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="SavedPosts" component={SavedPostsScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="CrushList" component={CrushesScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="Sound" component={SoundScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="UserProfile" component={UserProfileScreen} />
          <Stack.Screen name="Moments" component={MomentsScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="Search" component={SearchScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
          <Stack.Screen name="Circles" component={CirclesScreen} />
          <Stack.Screen name="Circle" component={CircleScreen} />
          <Stack.Screen name="CirclePreview" component={CirclePreviewScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="CircleManage" component={CircleManageScreen} options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Admin" component={AdminScreen} />
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
            <Stack.Screen name="VideoTrim" component={VideoTrimScreen} options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
            <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
            <Stack.Screen name="Plus" component={PlusScreen} />
          </Stack.Group>
          <Stack.Group screenOptions={{ presentation: 'transparentModal', animation: reduceMotion ? 'none' : 'fade', contentStyle: { backgroundColor: 'transparent' } }}>
            <Stack.Screen name="MomentViewer" component={MomentViewerScreen} options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: '#000' } }} />
          </Stack.Group>
        </>
      )}
    </Stack.Navigator>
  );
}
