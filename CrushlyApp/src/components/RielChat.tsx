import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { Input } from './Input';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import * as service from '../api/service';
import { useToast } from './Toast';

export type RielLine = { role: 'member' | 'riel'; text: string; suggestReport?: boolean };

const GREETING =
  'Hey, I’m Riel 👋 Your inside guy on holUpp. Want to know how to go viral, what’s working on Flow, or just vibe and talk? I’m here for all of it.';

/**
 * RielAi as a chat, not a help form: bubbles, a typing dot, and one input line.
 * Used in Whispers (the RielAi tab) and in Support. The conversation itself is
 * what gets handed to the model — nothing about the member's account, Whispers
 * or settings goes with it.
 */
export function RielChat({
  onReport,
  greeting = GREETING,
  testID,
}: {
  onReport?: () => void;
  greeting?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const scroll = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<RielLine[]>([{ role: 'riel', text: greeting }]);

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [lines.length, busy]);

  const send = async () => {
    const question = input.trim();
    if (busy || question.length < 1) return;
    setInput('');
    const history = lines.slice(-14);
    setLines((current) => [...current, { role: 'member', text: question }]);
    setBusy(true);
    try {
      const answer = await service.askRielAi(question, history);
      setLines((current) => [...current, { role: 'riel', text: answer.answer, suggestReport: answer.suggestReport }]);
    } catch (error) {
      setLines((current) => [
        ...current,
        {
          role: 'riel',
          text: 'My connection blinked for a second — say that again? If it keeps happening, tap Report a problem and a human will jump in.',
          suggestReport: true,
        },
      ]);
      toast({ kind: 'error', title: 'RielAi hiccuped', message: error instanceof Error ? error.message : 'Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }} testID={testID}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: space.md, paddingVertical: space.md, paddingBottom: space.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {lines.map((line, index) => (
          <View key={`${line.role}-${index}`} style={{ alignItems: line.role === 'member' ? 'flex-end' : 'flex-start' }}>
            <View
              style={{
                maxWidth: '86%',
                padding: space.md,
                borderRadius: radius.lg,
                backgroundColor: line.role === 'member' ? colors.primarySoft : colors.card,
                borderWidth: 1,
                borderColor: line.role === 'member' ? colors.primaryLine : colors.border,
              }}
            >
              <Txt variant="body" color={line.role === 'member' ? 'text' : 'textSecondary'} style={{ lineHeight: 22 }}>
                {line.text}
              </Txt>
              {line.suggestReport && onReport ? (
                <Pressable
                  onPress={onReport}
                  accessibilityRole="button"
                  accessibilityLabel="Report a problem"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, alignSelf: 'flex-start' }}
                >
                  <Ionicons name="flag-outline" size={14} color={colors.primary} />
                  <Txt variant="smallStrong" color="primary">
                    Report a problem
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        {busy ? (
          <View style={{ alignItems: 'flex-start' }} accessibilityLabel="Riel is typing">
            <View style={{ paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Txt variant="small" color="textMuted">
                Riel is typing…
              </Txt>
            </View>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end', paddingTop: space.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            value={input}
            onChangeText={setInput}
            placeholder="Message RielAi…"
            accessibilityLabel="Message RielAi"
            multiline
            maxLength={2000}
            editable={!busy}
            returnKeyType="send"
            onSubmitEditing={() => {
              void send();
            }}
          />
        </View>
        <Pressable
          onPress={() => {
            void send();
          }}
          disabled={busy || input.trim().length < 1}
          accessibilityRole="button"
          accessibilityLabel="Send to RielAi"
          style={({ pressed }) => ({
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: busy || input.trim().length < 1 ? colors.elevated : colors.primary,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="arrow-up" size={20} color={busy || input.trim().length < 1 ? colors.textMuted : colors.onPrimary ?? '#fff'} />
        </Pressable>
      </View>
    </View>
  );
}
