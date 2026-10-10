import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Chip, ChipGroup } from '../../components/Chip';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { Input } from '../../components/Input';
import { useToast } from '../../components/Toast';
import { useCreateCircle, useCrushes, useMyCircles } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Your Circles — the small rooms you belong to.
 *
 * A Circle is up to twelve people with their own posts and their own
 * conversation. It is not a public group and it is not searchable: you are in
 * one because you started it, or because somebody you have Clicked with
 * brought you in.
 */
export function CirclesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const circles = useMyCircles();
  const [creating, setCreating] = useState(false);

  const items = circles.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl refreshing={circles.isRefetching} onRefresh={circles.refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header">
              Circles
            </Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              Small rooms of up to twelve people, with their own posts and chat.
            </Txt>
          </View>
        </View>

        <Button
          title="Start a Circle"
          variant="primary"
          size="md"
          icon="add"
          style={{ marginTop: space.lg }}
          onPress={() => setCreating(true)}
        />

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          {circles.isLoading ? (
            <LoadingBlock label="Loading your Circles" />
          ) : circles.isError ? (
            <ErrorState message={circles.error instanceof Error ? circles.error.message : 'Your Circles didn’t load.'} onRetry={circles.refetch} />
          ) : items.length ? (
            items.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => navigation.navigate('Circle', { circleId: c.id })}
                accessibilityRole="button"
                accessibilityLabel={`Open ${c.name}${c.unreadCount ? `, ${c.unreadCount} new` : ''}`}
                style={{
                  backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.unreadCount ? colors.goldLine : colors.border,
                  padding: space.md,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View
                    style={{
                      width: 44, height: 44, borderRadius: 22, backgroundColor: colors.elevated,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color={c.unreadCount ? colors.gold : colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1, flexShrink: 1 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {c.name}
                    </Txt>
                    <Txt variant="caption" color="textMuted" numberOfLines={1} style={{ marginTop: 2 }}>
                      {c.about || `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
                    </Txt>
                  </View>
                  {c.unreadCount ? (
                    <View style={{ backgroundColor: colors.gold, borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Txt variant="caption" color="#0A0A0C">
                        {c.unreadCount > 99 ? '99+' : c.unreadCount}
                      </Txt>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.sm }}>
                  <Txt variant="caption" color="textMuted">
                    {c.memberCount}/12
                  </Txt>
                  {c.myRole === 'owner' ? (
                    <Txt variant="caption" color="gold">
                      · You started this
                    </Txt>
                  ) : null}
                  {c.lastMessageAt ? (
                    <Txt variant="caption" color="textMuted">
                      · {timeAgo(c.lastMessageAt)}
                    </Txt>
                  ) : null}
                </View>
              </Pressable>
            ))
          ) : (
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="No Circles yet"
              message="A Circle is a small room — up to twelve people you’ve Clicked with — with its own posts and its own chat. Start one, or wait for an invitation."
              action={{ label: 'Start a Circle', onPress: () => setCreating(true) }}
            />
          )}
        </View>
      </ScrollView>

      <CreateCircleSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

/** Starting a room: a name, a line about it, and who to bring in. */
function CreateCircleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const toast = useToast();
  const create = useCreateCircle();
  const crushes = useCrushes();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [picked, setPicked] = useState<number[]>([]);

  // You can only bring in people you have Clicked with — that is the rule the
  // database enforces, so the picker only offers those.
  const mutual = crushes.data?.mutual ?? [];

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 11 ? prev : [...prev, id]));

  const submit = async () => {
    try {
      const space = await create.mutateAsync({ name, about, memberIds: picked });
      setName('');
      setAbout('');
      setPicked([]);
      onClose();
      navigation.navigate('Circle', { circleId: space.circle.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Circle not created', message: (e as Error).message });
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Start a Circle">
      <View style={{ gap: space.md }}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Sunday Roast"
          maxLength={40}
          hint="Two to forty characters."
        />
        <Input
          label="What’s it for?"
          value={about}
          onChangeText={setAbout}
          placeholder="The usual suspects, every Sunday."
          maxLength={160}
        />

        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Bring people in ({picked.length}/11)
          </Txt>
          {mutual.length ? (
            <ChipGroup>
              {mutual.map((m) => (
                <Chip
                  key={m.id}
                  label={m.name}
                  selected={picked.includes(m.id)}
                  onPress={() => toggle(m.id)}
                  icon={picked.includes(m.id) ? 'checkmark-circle' : 'person-outline'}
                  size="sm"
                />
              ))}
            </ChipGroup>
          ) : (
            <Txt variant="small" color="textMuted">
              You can only bring in members you’ve Clicked with — you don’t have any yet. You can add people later.
            </Txt>
          )}
        </View>

        <Button title="Create Circle" variant="primary" size="md" onPress={submit} loading={create.isPending} disabled={name.trim().length < 2} />
      </View>
    </BottomSheet>
  );
}
