import React from 'react';
import { Linking, View } from 'react-native';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { InfoPage, ScreenProps } from '../../navigation/types';

type Block = { h?: string; p: string };
const SUPPORT_EMAIL = 'support@crushly.app';
const SAFETY_EMAIL = 'safety@crushly.app';

const PAGES: Record<InfoPage, { title: string; intro: string; blocks: Block[] }> = {
  guidelines: {
    title: 'Community guidelines',
    intro: 'Crushly is a private club for men who want real connection. A few simple rules keep it that way.',
    blocks: [
      { h: 'Be yourself', p: 'Use recent photos of you, your real first name and your real age. No impersonation, no catfishing.' },
      { h: 'Respect is the baseline', p: 'No harassment, hate speech, threats or pressure. “No” — or no reply — is an answer.' },
      { h: 'Keep it classy', p: 'No nudity or sexual content in profile photos or Moments. Don’t send explicit photos without clear consent.' },
      { h: 'Adults only', p: 'You must be 18 or older. We remove anyone who appears to be under 18.' },
      { h: 'No selling', p: 'No advertising, solicitation, escorting, scams or requests for money.' },
      { h: 'Protect privacy', p: 'Never share someone’s photos, messages or personal details without their permission. Never out anyone.' },
      { h: 'What happens when rules are broken', p: 'Reported content is reviewed by a person. Depending on severity, we may warn, restrict or permanently remove accounts.' },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    intro: 'Your privacy matters more here than almost anywhere. This summary explains what we collect and why.',
    blocks: [
      { h: 'What we collect', p: 'Your email, password (stored securely hashed), profile details, photos, Moments, messages, and an approximate location if you choose to share it.' },
      { h: 'Location', p: 'We store your location snapped to a coarse grid (roughly 1 km). Other members only ever see a rounded distance, and you can turn that off.' },
      { h: 'Verification selfies', p: 'Selfies are stored privately, seen only by our review team, and never shown on your profile.' },
      { h: 'What we never do', p: 'We don’t sell your data. We don’t show your sexuality, birthday or email to anyone.' },
      { h: 'Your controls', p: 'You can hide your profile, limit who can message or Crush on you, turn off online status and read receipts, and delete your account — which permanently removes your data.' },
    ],
  },
  terms: {
    title: 'Terms of service',
    intro: 'By using Crushly you agree to these terms. Plain-language summary:',
    blocks: [
      { h: 'Eligibility', p: 'You must be at least 18 and legally able to use the service where you live.' },
      { h: 'Your content', p: 'You own what you post. You give us permission to display it within Crushly so the service works.' },
      { h: 'Conduct', p: 'Follow the community guidelines. We may suspend accounts that put others at risk.' },
      { h: 'Crushly Plus', p: 'Paid features are not available yet. Joining early access is free and creates no obligation.' },
      { h: 'No guarantees', p: 'We work hard to keep Crushly safe, but we can’t guarantee the conduct of members. Use good judgement when meeting anyone.' },
    ],
  },
  help: {
    title: 'Help center',
    intro: 'Quick answers to common questions.',
    blocks: [
      { h: 'What’s a Crush?', p: 'It’s how you say “I’m interested.” If they Crush on you too, it’s a Mutual Crush and you can start talking.' },
      { h: 'What’s a Deep Crush?', p: 'A Crush with a note that appears at the top of their Crushes. You get 3 a day.' },
      { h: 'Who can message me?', p: 'By default, only Mutual Crushes. Change it in Privacy & visibility.' },
      { h: 'How does verification work?', p: 'Take a selfie copying a pose. A real person compares it with your photos — usually within a day.' },
      { h: 'How do Moments work?', p: 'Share a photo or a few words. Moments disappear after 24 hours. Replies arrive as private messages.' },
      { h: 'How do I take a break?', p: 'Settings → Account & security → Hide my profile. Your conversations stay open.' },
    ],
  },
  'safety-tips': {
    title: 'Dating safety tips',
    intro: 'Most people are here for the same reasons you are. These habits help you stay safe with the few who aren’t.',
    blocks: [
      { h: 'Take your time', p: 'Chat on Crushly before moving to other apps. Video call before meeting if you can.' },
      { h: 'Meet in public', p: 'Choose a busy café, restaurant or bar for the first few dates. Arrange your own transport.' },
      { h: 'Tell a friend', p: 'Share who you’re meeting, where and when. Check in during and after.' },
      { h: 'Guard your privacy', p: 'Don’t share your home address, workplace or financial details early on. Be careful with photos that reveal where you live.' },
      { h: 'Know the warning signs', p: 'Requests for money, pressure to move fast, refusing to video call, or stories that don’t add up. Trust your instincts.' },
      { h: 'Report and block', p: 'If something feels off, report it. Reports are confidential and the other person is never told.' },
      { h: 'Emergencies', p: 'If you’re in danger, contact local emergency services immediately. In Nigeria, dial 112.' },
    ],
  },
  contact: {
    title: 'Contact us',
    intro: 'We’re a small team and we read everything.',
    blocks: [
      { h: 'General support', p: `${SUPPORT_EMAIL} — account questions, bugs, feedback.` },
      { h: 'Safety team', p: `${SAFETY_EMAIL} — urgent safety concerns. For anything in-app, reporting directly from the profile or chat is fastest.` },
    ],
  },
};

export function InfoScreen({ route }: ScreenProps<'Info'>) {
  const { colors } = useTheme();
  const page = PAGES[route.params.page] ?? PAGES.help;
  return (
    <Screen>
      <Header title={page.title} back />
      <Txt variant="accent" color="textSecondary" style={{ marginBottom: space.lg }}>
        {page.intro}
      </Txt>
      <View style={{ gap: space.lg }}>
        {page.blocks.map((b) => (
          <View key={b.h ?? b.p}>
            {b.h ? (
              <Txt variant="subheading" accessibilityRole="header">
                {b.h}
              </Txt>
            ) : null}
            <Txt variant="body" color="textSecondary" style={{ marginTop: 4, lineHeight: 23 }}>
              {b.p}
            </Txt>
          </View>
        ))}
      </View>
      {route.params.page === 'contact' ? (
        <View style={{ gap: space.sm, marginTop: space.xl }}>
          <Button title="Email support" icon="mail-outline" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <Button title="Email the safety team" variant="secondary" icon="shield-outline" onPress={() => Linking.openURL(`mailto:${SAFETY_EMAIL}`)} />
        </View>
      ) : null}
      <View style={{ marginTop: space.xl, padding: space.md, borderRadius: radius.md, backgroundColor: colors.card }}>
        <Txt variant="caption" color="textMuted">
          This is a product summary, not legal advice. Have the final legal documents reviewed before a public launch.
        </Txt>
      </View>
    </Screen>
  );
}
