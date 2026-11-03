import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VideoEdit } from '../lib/videoEdit';

export type TabParamList = {
  Flows: undefined;
  Crushes: { tab?: 'incoming' | 'outgoing' | 'mutual' } | undefined;
  Messages: undefined;
  Profile: undefined;
};

export type InfoPage = 'guidelines' | 'privacy' | 'terms' | 'help' | 'safety-tips' | 'contact';

export type RootStackParamList = {
  /** The opening surface: "Follow the feelings", one tap from Welcome. */
  Follow: undefined;
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
  Discover: undefined;
  Search: { q?: string } | undefined;
  Filters: undefined;
  Notifications: undefined;
  Settings: undefined;
  EditProfile: undefined;
  Verification: undefined;
  Plus: { feature?: string } | undefined;
  MomentViewer: { userId: number; mine?: boolean };
  VibeViewer: { id: number };
  Circles: undefined;
  Circle: { circleId: number };
  CloseOnes: undefined;
  Moments: undefined;
  MomentComposer: undefined;
  VibeComposer: undefined;
  VideoTrim: { sourceUri: string; sourceDuration: number; category: 'post' | 'vibe' | 'moment' | 'circle'; initialEdit?: VideoEdit };
  /** `type` skips the "what are you sharing?" board — used by entry points
   *  that already are one thing, like the Moment button on a Space. */
  CreatePost:
    | {
        type?: 'flow' | 'vibe' | 'moment';
        /** Set when the composer was opened from a sound page. */
        soundId?: number;
        soundLabel?: string;
      }
    | undefined;
  /** A sound: its owner, how many clips are on it, and the clips. */
  Sound: { soundId: number };
  PostViewer: { postId: number };
  /** What you kept, newest first. Private: nobody else can read this list. */
  SavedPosts: undefined;
  WebPreview: { url: string };
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
