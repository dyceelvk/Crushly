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
import { Txt } from '../src/components/Txt';
import { useFonts } from 'expo-font';
import { Fraunces_500Medium_Italic, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, type NavigationState } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { AuthProvider, useAuth } from '../src/state/auth';
import { ToastProvider } from '../src/components/Toast';
import { MemberActionsProvider } from '../src/state/memberActions';
import { mockEntries, mockRpc, momentsFeedVideo } from './mocks';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { supabase } from '../src/api/client';

import {
  OnboardingIntentionsScreen,
  OnboardingBasicsScreen,
  OnboardingPhotosScreen,
  OnboardingAboutScreen,
  OnboardingPreferencesScreen,
} from '../src/screens/onboarding/Onboarding';
import { FeedScreen } from '../src/screens/flow/FeedScreen';
import { PostViewerScreen } from '../src/screens/flow/PostViewer';
import { MutualCrushScreen } from '../src/screens/crushes/MutualCrush';
import { ProfileTabScreen } from '../src/screens/profile/ProfileTab';
import { EditProfileScreen } from '../src/screens/profile/EditProfile';
import { UserProfileScreen } from '../src/screens/profile/UserProfile';
import { DiscoverScreen } from '../src/screens/discover/Discover';
import { SearchScreen } from '../src/screens/discover/Search';
import { CirclesScreen } from '../src/screens/circles/Circles';
import { CircleScreen } from '../src/screens/circles/Circle';
import { CloseOnesScreen } from '../src/screens/circles/CloseOnes';
import { MomentsScreen } from '../src/screens/moments/Moments';
import { MomentViewerScreen } from '../src/screens/moments/MomentViewer';
import { MomentComposerScreen } from '../src/screens/moments/MomentComposer';
import { CreatePostScreen } from '../src/screens/common/CreatePostScreen';
import { MessagesScreen } from '../src/screens/messages/Messages';
import { ChatScreen } from '../src/screens/messages/Chat';
import { SettingsScreen } from '../src/screens/settings/Settings';
import { TabBar } from '../src/navigation/TabBar';

/**
 * Navigation is real here, not a stub.
 *
 * Screens call `useNavigation()`, which reads the navigator's context — a
 * hand-made `nav` object passed as a prop never reached them, so every tap that
 * was supposed to navigate silently did nothing and no probe could tell. The
 * chosen screen is mounted as the initial route of a real stack, and every route
 * a screen can navigate to is registered as a stub; the current route is published
 * on `window.__route` so a probe can assert where a tap actually landed.
 */
declare global {
  interface Window { __route?: { name: string; params?: unknown; stack: string[] } }
}

const Stack = createNativeStackNavigator();

/** Routes a screen under test is allowed to reach. Registered so a wrong name
 *  fails loudly in the harness instead of only in production. */
const REACHABLE = [
  'PostViewer', 'VibeViewer', 'VibeComposer', 'Moments', 'MomentViewer', 'MomentComposer',
  'Circle', 'Verification', 'Main', 'UserProfile', 'Search', 'Discover',
  'Notifications', 'MutualCrush', 'Chat', 'Messages', 'EditProfile', 'Settings', 'Filters',
  'Privacy', 'Safety', 'BlockedUsers', 'Account', 'Appearance', 'Info', 'Plus',
  'NotificationSettings', 'Crushes', 'Circles', 'CloseOnes', 'Flow', 'ProfileTab',
];

function deepest(state?: NavigationState | { routes: any[] }): { name: string; params?: unknown; stack: string[] } {
  if (!state) return { name: 'Harness', stack: [] };
  const stack: string[] = [];
  let node: any = state;
  while (node?.routes?.length) {
    const route = node.routes[node.index ?? node.routes.length - 1];
    stack.push(route.name);
    node = route.state;
  }
  const last = stack[stack.length - 1] ?? 'Harness';
  const found = (state as any).routes?.find((r: any) => r.name === last);
  return { name: last, params: found?.params, stack };
}

function Stub({ route }: { route: { name: string; params?: unknown } }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}>
      <Txt variant="title">Stub · {route.name}</Txt>
      <Txt variant="small" color="textSecondary" style={{ marginTop: 6 }}>
        {JSON.stringify(route.params ?? {})}
      </Txt>
    </View>
  );
}

function Nav() {
  const Screen = chosen;
  return (
    <Stack.Navigator
      initialRouteName="Harness"
      screenOptions={{ headerShown: false }}
      screenListeners={{
        state: (e) => {
          if (typeof window !== 'undefined') window.__route = deepest(e.data.state as NavigationState);
        },
      }}
    >
      <Stack.Screen name="Harness" component={Screen as any} />
      {REACHABLE.map((name) => (
        <Stack.Screen key={name} name={name} component={Stub as any} />
      ))}
    </Stack.Navigator>
  );
}

const SCREENS: Record<string, (p: any) => React.ReactElement> = {
  flow: FeedScreen,
  profile: ProfileTabScreen,
  edit: EditProfileScreen,
  user: (p: any) => <UserProfileScreen route={{ key: 'u', name: 'UserProfile', params: { id: 2 } } as any} navigation={p.navigation} />,
  discover: DiscoverScreen,
  search: SearchScreen,
  circles: CirclesScreen,
  // A room with people in it, and one that is empty: the two states of the screen.
  circle: (p: any) => <CircleScreen route={{ key: 'c', name: 'Circle', params: { circleId: 1 } } as any} navigation={p.navigation} />,
  circleempty: (p: any) => <CircleScreen route={{ key: 'c', name: 'Circle', params: { circleId: 3 } } as any} navigation={p.navigation} />,
  closeones: CloseOnesScreen,
  moments: MomentsScreen,
  momentsvideo: MomentsScreen,
  moment: (p: any) => <MomentViewerScreen route={{ key: 'mv', name: 'MomentViewer', params: { userId: 2 } } as any} navigation={p.navigation} />,
  // A clip rather than a photo: the branch that plays.
  momentvideo: (p: any) => <MomentViewerScreen route={{ key: 'mv', name: 'MomentViewer', params: { userId: 5 } } as any} navigation={p.navigation} />,
  momentcomposer: MomentComposerScreen,
  // The composer opens on the question now: what is this?
  composer: (p: any) => <CreatePostScreen route={{ key: 'cp', name: 'CreatePost', params: undefined } as any} navigation={p.navigation} />,
  // …and straight into the Flow board, which is what the question leads to.
  composerflow: (p: any) => <CreatePostScreen route={{ key: 'cp', name: 'CreatePost', params: { type: 'flow' } } as any} navigation={p.navigation} />,
  messages: MessagesScreen,
  chat: (p: any) => <ChatScreen route={{ key: 'c', name: 'Chat', params: { conversationId: 1 } } as any} navigation={p.navigation} />,
  // A connection nobody has spoken to yet — the first thing a new match sees.
  chatempty: (p: any) => <ChatScreen route={{ key: 'c', name: 'Chat', params: { conversationId: 3 } } as any} navigation={p.navigation} />,
  settings: SettingsScreen,
  viewer: (p: any) => <PostViewerScreen route={{ key: 'v', name: 'PostViewer', params: { postId: 102 } } as any} navigation={p.navigation} />,
  viewerportrait: (p: any) => <PostViewerScreen route={{ key: 'v', name: 'PostViewer', params: { postId: 103 } } as any} navigation={p.navigation} />,
  // The match moment, as the person who felt it second sees it.
  mutual: (p: any) => <MutualCrushScreen route={{ key: 'mc', name: 'MutualCrush', params: { userId: 2, name: 'Ngozi', photo: 'http://127.0.0.1:8097/media/face2.jpg' } } as any} navigation={p.navigation} />,
  // The same moment reached through a notification, which carries no photo —
  // the screen has to go and get the face rather than draw an initial.
  mutualnophoto: (p: any) => <MutualCrushScreen route={{ key: 'mc', name: 'MutualCrush', params: { userId: 2, name: 'Ngozi' } } as any} navigation={p.navigation} />,
  // Your own post: the dots menu offers Edit and Delete, not Report.
  viewermine: (p: any) => <PostViewerScreen route={{ key: 'v', name: 'PostViewer', params: { postId: 101 } } as any} navigation={p.navigation} />,
  // The tab bar on its own. The bar is part of the navigator, and the harness
  // mounts screens rather than navigators — so the props it expects are stood up
  // by hand and the bar is drawn over a real screen.
  tabs: (p: any) => (
    <View style={{ flex: 1 }}>
      {SCREENS.flow(p)}
      <TabBar
        state={{
          index: 0,
          routes: [
            { key: 'Flows', name: 'Flows' },
            { key: 'Crushes', name: 'Crushes' },
            { key: 'Messages', name: 'Messages' },
            { key: 'Profile', name: 'Profile' },
          ],
        } as any}
        descriptors={
          {
            Flows: { options: { title: 'Flows' } },
            Crushes: { options: { title: 'Crushes' } },
            Messages: { options: { title: 'Messages' } },
            Profile: { options: { title: 'Profile' } },
          } as any
        }
        navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => {} } as any}
        onCreate={() => {}}
      />
    </View>
  ),
  intentions: OnboardingIntentionsScreen,
  basics: OnboardingBasicsScreen,
  photos: OnboardingPhotosScreen,
  about: OnboardingAboutScreen,
  preferences: OnboardingPreferencesScreen,
};

// Every RPC goes through the service; answering them here is what lets a
// screen's real hooks run without a backend. Installed before anything mounts.
// Shape matters: `service.rpc()` destructures `{ data, error }` off the client,
// so the stand-in has to answer in that envelope, not with a bare payload.
(supabase as any).rpc = async (fn: string, args: Record<string, any>) => {
  try {
    return { data: await mockRpc(fn, args), error: null };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
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
// `?s=momentsvideo` seeds the feed with a clip instead of a photo.
if (pick === 'momentsvideo' || pick === 'momentvideo') queryClient.setQueryData(['moments'], momentsFeedVideo);

function Inner() {
  const { status } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold, Fraunces_500Medium_Italic,
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
  });
  const ready = fontsLoaded || !!fontError;
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0A0E27' }} />;
  return (
    // The same boundary the shipped app mounts, so a harness render is a
    // faithful render: a crash looks like what a member would see.
    <ErrorBoundary>
      <View style={{ flex: 1 }} testID={`harness-${status}`}>
        <Nav />
      </View>
    </ErrorBoundary>
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
