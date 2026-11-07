import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VideoEdit } from '../lib/videoEdit';

export type TabParamList = {
  /** `tab` opens Home already on that part of the strip. */
  Flows: {
    tab?: 'crushes' | 'connections';
    /** Which lens of Crushes a notification means: who crushed you, or a match. */
    crushesTab?: 'incoming' | 'outgoing' | 'mutual';
  } | undefined;
  /** Discover is a destination of its own — it is where searching happens. */
  Discover: undefined;
  /** `tab` opens Whispers already on Close Ones — see the Space's count. */
  Messages: { tab?: 'whispers' | 'close' } | undefined;
  Profile: undefined;
};

export type InfoPage = 'guidelines' | 'privacy' | 'terms' | 'help' | 'safety-tips' | 'contact';

export type RootStackParamList = {
  /** The opening surface: "Follow the feelings", one tap from Welcome. */
  Follow: undefined;
  Welcome: undefined;
  SignIn: undefined;
  /** `email` opens straight on the code entry, for somebody whose
   *  account exists but was never confirmed — they need a code, not a form. */
  SignUp: { email?: string } | undefined;
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
  Search: { q?: string } | undefined;
  Filters: undefined;
  Notifications: undefined;
  Settings: undefined;
  EditProfile: undefined;
  Verification: undefined;
  Plus: { feature?: string } | undefined;
  MomentViewer: { userId: number; mine?: boolean };
  /** `create` opens the creator straight away — used by the Space's Circles tab. */
  Circles: { create?: boolean } | undefined;
  Circle: { circleId: number };
  /** A room you are not in yet: what it is, who is in it, and the way in. */
  CirclePreview: { circleId: number };
  /**
   * The owner's desk — members, requests, invitations, and the two switches.
   * `tab` lets a notification open the list it is about: a request should land
   * on Requests, not on Members with the request one tap away.
   */
  CircleManage: { circleId: number; tab?: 'members' | 'requests' | 'invited' | 'declined' };
  Moments: undefined;
  MomentComposer: undefined;
  VideoTrim: { sourceUri: string; sourceDuration: number; category: 'post' | 'moment' | 'circle'; initialEdit?: VideoEdit };
  /** `type` skips the "what are you sharing?" board — used by entry points
   *  that already are one thing, like the Moment button on a Space. */
  CreatePost:
    | {
        type?: 'flow' | 'moment';
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
  /** The people side of Crushes: who crushed you, and who you crushed. */
  CrushList: { tab?: 'incoming' | 'outgoing' | 'mutual' } | undefined;

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
