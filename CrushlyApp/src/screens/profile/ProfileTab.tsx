import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { ProgressBar, LoadingBlock } from '../../components/States';
import { ListRow, Group } from '../../components/ListRow';
import { useLayout } from '../../components/Layout';
import { CrushlyMark } from '../../components/Logo';
import { useCloseOnes, useMe, useMyCircles } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { intentionLabel } from '../../lib/catalog';
import type { RootStackParamList } from '../../navigation/types';

export function ProfileTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { data: me, refetch, isRefetching } = useMe();
  const closeOnes = useCloseOnes();
  const circles = useMyCircles();

  if (!me) return <LoadingBlock label="Loading your Space" />;
  const p = me.profile;
  const v = me.verification.status;
  const pct = me.completion.percent;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.xxxl, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="display" accessibilityRole="header">
          Space
        </Txt>
        <IconButton icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
      </View>

      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <Avatar uri={p.photos[0]?.url} name={p.name} size={116} ring="gold" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md }}>
          <Txt variant="heading">
            {p.name}
            {p.age ? `, ${p.age}` : ''}
          </Txt>
          {v === 'verified' ? <VerifiedBadge size={20} /> : null}
        </View>
        {p.username ? (
          <Txt variant="bodyStrong" color="gold" style={{ marginTop: 2 }}>
            {`@${p.username}`}
          </Txt>
        ) : null}
        <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
          {[p.city, p.pronouns, p.intentions.slice(0, 2).map(intentionLabel).join(' · ')].filter(Boolean).join('  ·  ')}
        </Txt>
        {me.status === 'paused' ? (
          <View style={{ marginTop: space.sm, backgroundColor: colors.goldSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Txt variant="smallStrong" color="gold">
              Space hidden from Discover
            </Txt>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg, width: '100%', maxWidth: 380 }}>
          <View style={{ flex: 1 }}>
            <Button title="Edit Space" size="md" variant="secondary" onPress={() => navigation.navigate('EditProfile')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="New Moment" size="md" variant="outline" onPress={() => navigation.navigate('MomentComposer')} />
          </View>
        </View>
      </View>

      {pct < 100 ? (
        <View style={{ marginTop: space.xl, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Txt variant="subheading">Space {pct}% complete</Txt>
            <Txt variant="smallStrong" color="gold" onPress={() => navigation.navigate('EditProfile')} accessibilityRole="link">
              Finish
            </Txt>
          </View>
          <ProgressBar value={pct / 100} style={{ marginTop: space.sm }} label={`Space ${pct}% complete`} />
          <View style={{ marginTop: space.md, gap: 6 }}>
            {me.completion.missing.slice(0, 3).map((k) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="ellipse-outline" size={12} color={colors.textMuted} />
                <Txt variant="small" color="textSecondary">
                  {k}
                </Txt>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {v !== 'verified' ? (
        <Group style={{ marginTop: space.lg }}>
          <ListRow
            title={v === 'pending' ? 'Verification in review' : v === 'rejected' ? 'Verification needs another try' : 'Get verified'}
            subtitle={v === 'pending' ? 'We’ll let you know as soon as it’s done.' : 'Make your Space more trustworthy.'}
            icon="shield-checkmark-outline"
            iconTone={v === 'pending' ? 'neutral' : 'gold'}
            onPress={() => navigation.navigate('Verification')}
            last
          />
        </Group>
      ) : null}

      <Pressable onPress={() => navigation.navigate('Plus', {})} accessibilityRole="button" accessibilityLabel="Crushly Plus. Learn more">
        <LinearGradient
          colors={[colors.goldSoft, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ marginTop: space.lg, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.goldLine, flexDirection: 'row', alignItems: 'center', gap: space.md }}
        >
          <CrushlyMark size={36} />
          <View style={{ flex: 1 }}>
            <Txt variant="subheading">Crushly Plus</Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              {me.plus.interested ? 'You’re on the early access list.' : 'More Big Crushes, Incognito, and travel mode.'}
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.gold} />
        </LinearGradient>
      </Pressable>

      <Group title="Your people" style={{ marginTop: space.xl }}>
        <ListRow
          title="Close Ones"
          subtitle={closeOnes.data?.items.length ? `${closeOnes.data.items.length} you keep close` : 'People you’ve chosen to keep near'}
          icon="bookmark-outline"
          iconTone="gold"
          onPress={() => navigation.navigate('CloseOnes')}
        />
        <ListRow
          title="Circles"
          subtitle={circles.data?.items.length ? `${circles.data.items.length} ${circles.data.items.length === 1 ? 'room' : 'rooms'}` : 'Small rooms of up to twelve people'}
          icon="chatbubble-ellipses-outline"
          onPress={() => navigation.navigate('Circles')}
          last
        />
      </Group>

      <Group title="Your space" style={{ marginTop: space.xl }}>
        <ListRow title="Discover preferences" icon="options-outline" onPress={() => navigation.navigate('Filters')} />
        <ListRow title="Privacy" icon="eye-off-outline" onPress={() => navigation.navigate('Privacy')} />
        <ListRow title="Safety center" icon="shield-outline" iconTone="success" onPress={() => navigation.navigate('Safety')} />
        <ListRow title="Crush Alerts" icon="notifications-outline" onPress={() => navigation.navigate('Notifications')} />
        <ListRow title="Settings" icon="settings-outline" onPress={() => navigation.navigate('Settings')} last />
      </Group>
    </ScrollView>
  );
}

