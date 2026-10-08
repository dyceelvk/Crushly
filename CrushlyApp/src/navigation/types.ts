import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  Discover: undefined;
  Crushes: { tab?: 'incoming' | 'outgoing' | 'mutual' } | undefined;
  Messages: undefined;
  Moments: undefined;
  Profile: undefined;
};

export type InfoPage = 'guidelines' | 'privacy' | 'terms' | 'help' | 'safety-tips' | 'contact';

export type RootStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  SetPassword: undefined;
  OnboardingIntentions: undefined;
  OnboardingBasics: undefined;
  OnboardingPhotos: undefined;
  OnboardingAbout: undefined;
  OnboardingPreferences: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  UserProfile: { id: number };
  Chat: { conversationId: number };
  MutualCrush: { userId: number; name: string; photo?: string | null };
  Filters: undefined;
  Notifications: undefined;
  Settings: undefined;
  EditProfile: undefined;
  Verification: undefined;
  Plus: { feature?: string } | undefined;
  MomentViewer: { userId: number; mine?: boolean };
  MomentComposer: undefined;
  Safety: undefined;
  Privacy: undefined;
  BlockedUsers: undefined;
  Account: undefined;
  NotificationSettings: undefined;
  Appearance: undefined;
  Info: { page: InfoPage };
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
