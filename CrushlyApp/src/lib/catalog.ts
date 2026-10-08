import type { Ionicons } from '@expo/vector-icons';
import type { Intention, MomentStyle } from '../api/types';

/** Mirrors server/src/lib/validate.js — keep in sync. */
export const INTENTIONS: { value: Intention; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'dating', label: 'Dating', description: 'Going on dates and seeing where it leads', icon: 'wine-outline' },
  { value: 'relationship', label: 'Relationship', description: 'Someone to build something real with', icon: 'infinite-outline' },
  { value: 'friends', label: 'Friends', description: 'Good people, good company', icon: 'people-outline' },
  { value: 'casual', label: 'Something casual', description: 'Easygoing, no pressure', icon: 'flame-outline' },
  { value: 'new_connections', label: 'New connections', description: 'Expanding your circle', icon: 'git-network-outline' },
  { value: 'not_sure', label: 'Not sure yet', description: 'Open to whatever feels right', icon: 'compass-outline' },
];

export const intentionLabel = (v: string) =>
  ({ dating: 'Dating', relationship: 'Relationship', friends: 'Friends', casual: 'Casual', new_connections: 'New connections', not_sure: 'Open to anything' } as Record<string, string>)[v] || v;

/** Filter chips per the Discover preferences spec. "Open to anything" = no intention filter. */
export const FILTER_INTENTIONS: { value: Intention; label: string }[] = [
  { value: 'dating', label: 'Dating' },
  { value: 'relationship', label: 'Relationship' },
  { value: 'friends', label: 'Friends' },
  { value: 'casual', label: 'Casual' },
  { value: 'new_connections', label: 'New connections' },
];

export const INTERESTS = [
  'Music', 'Fitness', 'Fashion', 'Gaming', 'Travel', 'Movies', 'Food', 'Art', 'Business',
  'Books', 'Nightlife', 'Photography', 'Outdoors', 'Tech', 'Cooking', 'Dancing', 'Wellness',
  'Sports', 'Theatre', 'Coffee', 'Design', 'Afrobeats', 'Football', 'Wine',
];

export const FILTER_INTERESTS = ['Music', 'Fitness', 'Fashion', 'Gaming', 'Travel', 'Movies', 'Food', 'Art', 'Business', 'Books', 'Nightlife', 'Design'];

export const LANGUAGES = [
  'English', 'French', 'Spanish', 'Portuguese', 'German', 'Italian', 'Yoruba', 'Igbo', 'Hausa',
  'Swahili', 'Arabic', 'Mandarin', 'Hindi', 'Dutch', 'Twi', 'Zulu', 'Amharic', 'Japanese',
];

export const RELATIONSHIP_INTENTIONS = [
  'Long-term partner', 'Long-term, open to short', 'Short-term, open to long',
  'Something casual', 'New friends', 'Still figuring it out',
];

export const PRONOUNS = ['he/him', 'he/they', 'they/them'];

export const LIFESTYLE: { key: 'workout' | 'drinking' | 'smoking' | 'pets' | 'zodiac'; label: string; icon: keyof typeof Ionicons.glyphMap; options: string[] }[] = [
  { key: 'workout', label: 'Workout', icon: 'barbell-outline', options: ['Often', 'Sometimes', 'Rarely', 'Never'] },
  { key: 'drinking', label: 'Drinking', icon: 'wine-outline', options: ['Socially', 'Rarely', 'Never', 'Sober'] },
  { key: 'smoking', label: 'Smoking', icon: 'leaf-outline', options: ['Never', 'Socially', 'Regularly'] },
  { key: 'pets', label: 'Pets', icon: 'paw-outline', options: ['Dog person', 'Cat person', 'Both', 'Neither'] },
  { key: 'zodiac', label: 'Zodiac', icon: 'moon-outline', options: ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] },
];

export const MOMENT_STYLES: Record<MomentStyle, { label: string; colors: [string, string, string]; ink: string }> = {
  noir: { label: 'Noir', colors: ['#1E1E22', '#111113', '#070708'], ink: '#FFFFFF' },
  champagne: { label: 'Champagne', colors: ['#3A2F1C', '#1C170F', '#0B0906'], ink: '#F3DDA6' },
  crimson: { label: 'Crimson', colors: ['#4A1020', '#22070F', '#0B0306'], ink: '#FFD7DF' },
  midnight: { label: 'Midnight', colors: ['#16203A', '#0B1020', '#05070D'], ink: '#DCE6FF' },
  emerald: { label: 'Emerald', colors: ['#0F3328', '#081A14', '#030A08'], ink: '#CFF5E6' },
};

export const STICKERS: { key: string; emoji: string; label: string }[] = [
  { key: 'wave', emoji: '👋', label: 'Hello' },
  { key: 'blush', emoji: '😊', label: 'Blush' },
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'cheers', emoji: '🥂', label: 'Cheers' },
  { key: 'wink', emoji: '😉', label: 'Wink' },
  { key: 'heart_eyes', emoji: '😍', label: 'Heart eyes' },
  { key: 'coffee', emoji: '☕', label: 'Coffee?' },
  { key: 'crown', emoji: '👑', label: 'King' },
];

export const MOMENT_REACTIONS: { key: string; emoji: string; label: string }[] = [
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'laugh', emoji: '😂', label: 'Laugh' },
  { key: 'wow', emoji: '😮', label: 'Wow' },
  { key: 'clap', emoji: '👏', label: 'Applause' },
];

export const REPORT_REASONS: { value: string; label: string; description: string }[] = [
  { value: 'fake_profile', label: 'Fake profile or catfishing', description: 'Photos or details that aren’t theirs' },
  { value: 'harassment', label: 'Harassment or bullying', description: 'Unwanted, hostile or abusive behaviour' },
  { value: 'inappropriate_content', label: 'Inappropriate content', description: 'Explicit or offensive photos or messages' },
  { value: 'scam', label: 'Scam or spam', description: 'Asking for money, links, or selling something' },
  { value: 'threats_safety', label: 'Threats or outing', description: 'Threats, blackmail or exposing someone' },
  { value: 'hate_speech', label: 'Hate speech', description: 'Attacks based on identity' },
  { value: 'underage', label: 'Might be under 18', description: 'Crushly is strictly for adults' },
  { value: 'other', label: 'Something else', description: 'Tell us what happened' },
];

export const distanceLabel = (km: number) => (km === 0 ? 'Anywhere' : `Within ${km} km`);
