import React from 'react';
import { Linking, View } from 'react-native';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { InfoPage, ScreenProps } from '../../navigation/types';
import {
  COMPANY_NAME,
  LEGAL_EMAIL,
  PRIVACY_EMAIL,
  SAFETY_EMAIL,
  SUPPORT_EMAIL,
  companyEntityLine,
  companyUrl,
  jurisdictionCourts,
  jurisdictionLaw,
} from '../../lib/company';

type Block = { h?: string; p: string };

const ENTITY = companyEntityLine();

/** Where each page lives on the company website, once COMPANY_SITE is set. */
const LEGAL_PATHS: Partial<Record<InfoPage, string>> = {
  terms: 'legal/terms',
  privacy: 'legal/privacy',
  guidelines: 'legal/guidelines',
  'safety-tips': 'legal/safety',
};
const LEGAL_PAGES: InfoPage[] = ['terms', 'privacy', 'guidelines'];

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
    intro: `${ENTITY} (“Riel Inc.”, “we”) is the data controller for Crushly. This policy explains what we collect, why, who we share it with, and the rights you have under the data protection law that applies to you.`,
    blocks: [
      { h: '1. What we collect', p: 'Account data (email address and a securely hashed password), profile data (first name, date of birth, bio, interests, intentions, preferences), the photos and Moments you post, the messages and voice or video notes you send, device and log data needed to run and secure the service, and an approximate location if you choose to share it.' },
      { h: '2. Identity verification', p: 'Verification is carried out by Didit, an independent identity provider. Didit captures a live selfie and a government identity document, runs liveness and face-match checks, and returns only the outcome to us. Crushly does not receive or store your document image. Biometric processing is performed by Didit under its own terms; we use the result solely to set or refuse the verified badge.' },
      { h: '3. Location', p: 'If you grant location permission we store your position snapped to a coarse grid (roughly 1 km). Other members only ever see a rounded distance, never your actual location, and you can withdraw permission at any time.' },
      { h: '4. Why we use your data, and our legal bases', p: 'To create and run your account and to provide matching, messaging and safety features (performance of a contract); to verify identity and investigate fraud or abuse (legitimate interests and legal obligation); to send service and safety communications (contract and legitimate interests); and, where you opt in, for anything optional you consent to. We rely on consent only where we ask for it, and you may withdraw it at any time.' },
      { h: '5. Who we share it with', p: 'Service providers who process data on our instructions: our backend and storage provider (Supabase), our identity-verification provider (Didit), our web host (Netlify) and our email delivery provider. Regulators, courts or law enforcement where disclosure is required by applicable law or necessary to prevent serious harm or investigate fraud. We do not sell your personal data and we do not share it for third-party advertising or profiling.' },
      { h: '6. International transfers', p: 'Some providers store or process data outside your own country. Where that happens we rely on contractual safeguards and on the provider’s own security commitments to protect your data to a standard comparable to applicable data protection law.' },
      { h: '7. How long we keep it', p: 'We keep account data while your account is open. Messages, Moments and media are deleted or irreversibly anonymised when you delete them or close your account, subject to backup cycles and to records we must retain to comply with law, resolve disputes or investigate safety and fraud reports.' },
      { h: '8. How we protect it', p: 'Traffic is encrypted in transit, passwords are stored only as salted hashes, and sessions on mobile are held in the operating system’s secure storage. Access to production data is restricted to people who need it. No service can promise perfect security, and you help by using a strong, unique password and not sharing your login.' },
      { h: '9. Your rights', p: 'Under applicable data protection law you may request access to your data, correction of anything inaccurate, deletion, restriction of processing, portability, and you may object to processing based on legitimate interests or withdraw consent. Use the controls in Settings or email us. You may also lodge a complaint with the data protection authority where you live.' },
      { h: '10. Scams, fraud and reporting', p: 'When you report a member we keep the report and the related messages so we can investigate, act and, where appropriate, assist law enforcement. Reporting is confidential: the person reported is not told who reported them. We never ask you for your password, a one-time code, or payment details in order to investigate a report.' },
      { h: '11. Automated decisions', p: 'The verification outcome is reached automatically by Didit’s checks. It affects only whether a badge appears. If you believe a result is wrong you can request a review by contacting us, and you can keep using Crushly without verifying.' },
      { h: '12. Cookies and local storage', p: 'On the web we use browser storage and similar technologies to keep you signed in and to remember your settings. You can clear this in your browser at any time, though it will sign you out.' },
      { h: '13. Children', p: 'Crushly is for adults. We do not knowingly collect data from anyone under 18, and we remove accounts we believe belong to a minor.' },
      { h: '14. Changes to this policy', p: 'We may update this policy. The current version is always available in the app, and material changes will be communicated in the app or by email.' },
      { h: '15. Contact and complaints', p: `Privacy questions and rights requests: ${PRIVACY_EMAIL}. General support: ${SUPPORT_EMAIL}. You may also contact the data protection authority where you live if you are unhappy with how we have handled your data.` },
    ],
  },
  terms: {
    title: 'Terms of service',
    intro: `These terms are a binding agreement between you and ${ENTITY} (“Riel Inc.”, “we”, “us”), the company that operates Crushly. Read them alongside our Community Guidelines and Privacy Policy.`,
    blocks: [
      { h: '1. Acceptance', p: 'By creating an account or using Crushly you confirm that you have read, understood and agreed to these terms. If you do not agree, do not use Crushly.' },
      { h: '2. Eligibility', p: 'You must be at least 18 years old, have legal capacity to contract, and not have been previously removed from Crushly. One person may hold one account. Accounts are personal and may not be transferred or sold.' },
      { h: '3. We are a platform, not a party to what happens between members', p: 'Crushly introduces people. We do not organise, participate in, supervise, endorse or profit from any conversation, meeting, relationship, agreement or payment between members. Anything you arrange with another member is solely between the two of you. Riel Inc. is not a party to it, makes no representation about it, and accepts no responsibility for it.' },
      { h: '4. No screening, and what a verification badge does and does not mean', p: 'We do not run criminal-background, identity-history or credit checks on members as a matter of routine. A verification badge means only that an identity document and a live liveness/face-match check were completed. It is not a character reference, not a safety guarantee, and not confirmation that a person is who they say they are offline. Verify people yourself, and use your own judgement before meeting anyone, sharing personal information, or parting with anything of value.' },
      { h: '5. Fraud, scams and requests for money', p: 'Soliciting money, gifts, vouchers, cryptocurrency, bank or card details, or financial help of any kind — including romance, emergency or investment-style requests — is a serious breach of these terms. We may suspend or remove the account immediately and refer the matter to law enforcement. Riel Inc. does not hold, process or reimburse money sent between members, cannot recover it, and is not liable for any loss arising from it. If anyone on Crushly asks you for money, report them and stop communicating with them.' },
      { h: '6. Your promises to us', p: 'You confirm that: everything you post is yours or you have permission to post it; your age, first name and photos are genuine and current; you will not impersonate anyone; and you will not use Crushly for anything unlawful, exploitative or harmful.' },
      { h: '7. The licence you give us', p: 'You keep ownership of what you post. You grant Riel Inc. a worldwide, non-exclusive, royalty-free licence to store, host, reproduce, display, distribute, adapt for delivery and publicly promote that content for the purpose of operating and marketing Crushly. The licence ends when the content is deleted, except for copies retained in backups or where retention is legally required.' },
      { h: '8. Prohibited conduct', p: 'In addition to the Community Guidelines, you must not scrape or copy the service, reverse engineer it, run bots or automated accounts, sell or buy accounts, advertise or solicit, distribute unlawful or non-consensual intimate material, or attempt to gain unauthorised access to any account or system.' },
      { h: '9. Crushly Plus and payments', p: 'Paid features are not currently available and nothing is charged. When payment features launch, the price, renewal terms and refund rules shown at the point of purchase form part of these terms.' },
      { h: '10. Safety reporting and cooperation with authorities', p: 'We may review reports, preserve records, and disclose information to law enforcement, a regulator or a court where required by applicable law or where we believe it is necessary to prevent serious harm or to investigate fraud. Reports are handled confidentially.' },
      { h: '11. Suspension and termination', p: 'We may warn, restrict, suspend or permanently remove an account, with or without notice, where we believe these terms, the guidelines or the law have been broken, or where safety is at risk. We are not liable for any loss caused by a removal. You may delete your account at any time in Settings.' },
      { h: '12. No warranty', p: 'Crushly is provided “as is” and “as available”. To the fullest extent permitted by law we exclude all warranties, express or implied, including any warranty that the service will be uninterrupted, error-free or secure, and any warranty as to the conduct, identity, intentions or suitability of any member.' },
      { h: '13. Limitation of our liability', p: 'To the fullest extent permitted by applicable law, Riel Inc. is not liable for any indirect, incidental, special, consequential or punitive loss, or for loss of profit, goodwill, reputation, data or opportunity. Our total aggregate liability arising out of or in connection with Crushly is limited to the greater of the amount you have paid us in the twelve months before the claim, or the equivalent of US$50 in local currency. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be limited.' },
      { h: '14. You indemnify us', p: 'You agree to indemnify and hold Riel Inc., its officers and partners harmless against any claim, loss, damage, cost or expense (including reasonable legal fees) arising from your content, your use of Crushly, your breach of these terms, or any interaction or transaction between you and another member.' },
      { h: '15. Governing law and jurisdiction', p: `These terms are governed by ${jurisdictionLaw()}. You and Riel Inc. submit to the exclusive jurisdiction of ${jurisdictionCourts()}, and you waive any objection to that venue or to the convenience of that forum.` },
      { h: '16. Individual claims only', p: 'To the extent permitted by law, any claim must be brought in your individual capacity. Claims brought on behalf of a class, group or other persons are not permitted.' },
      { h: '17. Costs of proceedings in the wrong forum', p: 'If you commence proceedings in a forum other than the one agreed in clause 15 and those proceedings are dismissed, stayed or transferred, you agree to bear Riel Inc.’s reasonable legal costs of responding, without prejudice to any other remedy available to us.' },
      { h: '18. Injunctive relief', p: 'You acknowledge that a breach of these terms affecting intellectual property, safety or confidentiality may cause irreparable harm for which damages alone are inadequate, and that Riel Inc. may seek injunctive or other equitable relief in addition to any other remedy.' },
      { h: '19. Changes to these terms', p: 'We may update these terms. The current version is always in the app. Continuing to use Crushly after a change means you accept the updated terms.' },
      { h: '20. General', p: 'If any clause is held unenforceable, the rest remain in force. A failure to enforce a clause is not a waiver of it. These terms, the Community Guidelines and the Privacy Policy are the entire agreement between you and Riel Inc. regarding Crushly.' },
      { h: '21. Contact', p: `Questions about these terms: ${LEGAL_EMAIL}. General support: ${SUPPORT_EMAIL}.` },
    ],
  },
  help: {
    title: 'Help center',
    intro: 'Quick answers to common questions.',
    blocks: [
      { h: 'What’s a Crush?', p: 'It’s how you say “I’m interested.” If they Crush on you too, it’s a Mutual Crush and you can start talking.' },
      { h: 'What’s a Deep Crush?', p: 'A Crush with a note that appears at the top of their Crushes. You get 3 a day.' },
      { h: 'Who can message me?', p: 'By default, only Mutual Crushes. Change it in Privacy & visibility.' },
      { h: 'How does verification work?', p: 'Tap “Verify with Didit”. Crushly hands you to our identity partner, which captures a live selfie and checks your ID, then brings you straight back. Opening the check submits nothing on its own, and photos from your gallery can’t be used.' },
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
      { h: 'Emergencies', p: 'If you’re in danger, contact your local emergency services immediately.' },
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
  const key = route.params.page;
  const page = PAGES[key] ?? PAGES.help;
  // Null until COMPANY_SITE is set in lib/company.ts — the app never links to a
  // domain Riel Inc. doesn't own.
  const legalPath = LEGAL_PATHS[key];
  const legalLink = legalPath ? companyUrl(legalPath) : null;
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
      <View style={{ marginTop: space.xl, gap: space.sm }}>
        {legalLink ? (
          <Button
            title={`Read this on the ${COMPANY_NAME} website`}
            variant="secondary"
            icon="open-outline"
            onPress={() => void Linking.openURL(legalLink)}
          />
        ) : null}
        <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.card }}>
          <Txt variant="caption" color="textMuted">
            {`Crushly is a product of ${COMPANY_NAME}. `}
            {LEGAL_PAGES.includes(key)
              ? 'This is a summary of the full document and is not legal advice. Have the final wording reviewed by qualified legal counsel before a public launch.'
              : 'This page is product information and is not legal advice.'}
          </Txt>
        </View>
      </View>
    </Screen>
  );
}
