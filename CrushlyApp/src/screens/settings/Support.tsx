import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen, Header, Card } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import * as service from '../../api/service';
import type { ScreenProps } from '../../navigation/types';

type ChatLine = { role: 'member' | 'riel'; text: string; suggestReport?: boolean };

/** Member-facing RielAi. It is deliberately a help-only surface: questions go
 * to the approved help-content edge function, not to the member's profile,
 * Whispers, or any administrator workspace. */
export function RielAiScreen({ navigation }: ScreenProps<'RielAi'>) {
  const { colors } = useTheme();
  const toast = useToast();
  const scroll = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([
    {
      role: 'riel',
      text: 'Hey, I’m Riel 👋 Ask me anything — how holUpp works, how to grow your Space, what to post, or just what’s on your mind. I can’t see your private stuff, so what you say here stays between us.',
    },
  ]);

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(timer);
  }, [lines.length]);

  const ask = async () => {
    const question = input.trim();
    if (busy || question.length < 2) return;
    setInput('');
    setLines((current) => [...current, { role: 'member', text: question }]);
    setBusy(true);
    try {
      const answer = await service.askRielAi(question, lines);
      setLines((current) => [...current, { role: 'riel', text: answer.answer, suggestReport: answer.suggestReport }]);
    } catch (error) {
      toast({ kind: 'error', title: 'RielAi is unavailable', message: error instanceof Error ? error.message : 'Try again or report the problem to support.' });
      setLines((current) => [...current, { role: 'riel', text: 'I couldn’t reach the help service just now. You can try again, or send the details to human support.' , suggestReport: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboard scroll={false} contentStyle={{ paddingBottom: space.md }}>
      <Header title="Ask RielAi" subtitle="Quick answers from holUpp’s Help center" back />
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: space.md, paddingBottom: space.md }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
          <Txt variant="small" color="textSecondary">
            Riel is holUpp’s own AI mate — chat about anything: growth, content, dating, the app. It has no access to your private Whispers, your account details, or anyone else’s data.
          </Txt>
        </View>
        {lines.map((line, index) => (
          <View key={`${line.role}-${index}`} style={{ alignItems: line.role === 'member' ? 'flex-end' : 'flex-start' }}>
            <View style={{ maxWidth: '90%', padding: space.md, borderRadius: radius.lg, backgroundColor: line.role === 'member' ? colors.primarySoft : colors.card, borderWidth: 1, borderColor: line.role === 'member' ? colors.primaryLine : colors.border }}>
              <Txt variant="body" color={line.role === 'member' ? 'text' : 'textSecondary'} style={{ lineHeight: 22 }}>
                {line.text}
              </Txt>
              {line.suggestReport ? (
                <Button
                  title="Report a problem"
                  size="sm"
                  variant="secondary"
                  icon="flag-outline"
                  full={false}
                  style={{ marginTop: space.md }}
                  onPress={() => navigation.navigate('Support', { source: 'riel_ai' })}
                />
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ gap: space.sm, paddingTop: space.sm }}>
        <Input
          label="Your message"
          value={input}
          onChangeText={setInput}
          placeholder="How do I blow up on holUpp?"
          multiline
          maxLength={2000}
          showCount
          editable={!busy}
          returnKeyType="send"
          onSubmitEditing={() => { void ask(); }}
        />
        <Button title={busy ? 'Riel is typing…' : 'Send'} icon="sparkles-outline" loading={busy} disabled={input.trim().length < 2} onPress={() => { void ask(); }} />
        <Button title="Need human support?" variant="ghost" size="sm" full={false} onPress={() => navigation.navigate('Support', { source: 'riel_ai' })} />
      </View>
    </Screen>
  );
}

export function SupportScreen({ navigation, route }: ScreenProps<'Support'>) {
  const { colors } = useTheme();
  const toast = useToast();
  const [category, setCategory] = useState<'report_problem' | 'feedback' | 'account' | 'safety' | 'other'>('report_problem');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<number | null>(null);
  const fromRiel = route.params?.source === 'riel_ai';

  const submit = async () => {
    if (busy || subject.trim().length < 2 || body.trim().length < 2) return;
    setBusy(true);
    try {
      const result = await service.createSupportTicket({ category, subject, body, source: fromRiel ? 'riel_ai' : 'app' });
      setTicket(result.id);
      toast({ kind: 'success', title: 'Sent to support', message: `Your support request is #${result.id}.` });
    } catch (error) {
      toast({ kind: 'error', title: 'Couldn’t send the report', message: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setBusy(false);
    }
  };

  if (ticket) {
    return (
      <Screen>
        <Header title="Report a problem" back />
        <Card style={{ gap: space.md, marginTop: space.md }}>
          <Txt variant="heading">Support request sent</Txt>
          <Txt variant="body" color="textSecondary" style={{ lineHeight: 23 }}>
            We saved your description for the support team. Keep this reference number if you contact us again: #{ticket}.
          </Txt>
          <Button title="Ask RielAi another question" icon="sparkles-outline" onPress={() => navigation.navigate('RielAi')} />
          <Button title="Back to settings" variant="secondary" onPress={() => navigation.navigate('Settings')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <Header title="Report a problem" subtitle="Tell the support team what went wrong." back />
      <View style={{ padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: space.lg }}>
        <Txt variant="small" color="textSecondary">
          This is for holUpp product, account, and safety support. If you are reporting another member, use Flag from their Space or Whisper instead.
        </Txt>
      </View>
      <View style={{ gap: space.lg }}>
        <View>
          <Txt variant="label" color="textSecondary" style={{ marginBottom: space.xs, marginLeft: 4 }}>What kind of help do you need?</Txt>
          <Segmented
            value={category}
            onChange={setCategory}
            options={[
              { value: 'report_problem', label: 'Problem' },
              { value: 'account', label: 'Account' },
              { value: 'safety', label: 'Safety' },
              { value: 'feedback', label: 'Feedback' },
            ]}
          />
        </View>
        <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="For example: my notifications are not updating" maxLength={160} showCount editable={!busy} />
        <Input label="What happened?" value={body} onChangeText={setBody} placeholder="Include the steps that led to the problem and what you expected to happen." multiline maxLength={12000} showCount editable={!busy} />
        <Button title="Send to support" icon="paper-plane-outline" loading={busy} disabled={subject.trim().length < 2 || body.trim().length < 2} onPress={() => { void submit(); }} />
        <Button title="Ask RielAi first" variant="ghost" icon="sparkles-outline" full={false} onPress={() => navigation.navigate('RielAi')} />
      </View>
    </Screen>
  );
}
