import React, { useState } from 'react';
import { View } from 'react-native';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Chip, ChipGroup } from '../../components/Chip';
import { RangeSlider } from '../../components/Slider';
import { ListRow, Group } from '../../components/ListRow';
import { IconButton } from '../../components/IconButton';
import { useToast } from '../../components/Toast';
import { useMe, useUpdatePreferences } from '../../api/hooks';
import type { Intention } from '../../api/types';
import { FILTER_INTENTIONS, FILTER_INTERESTS, distanceLabel } from '../../lib/catalog';
import { space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

const DISTANCES = [2, 5, 10, 25, 50, 100, 200, 0];
const DEFAULTS = { ageMin: 18, ageMax: 45, maxDistance: 50, intentions: [] as Intention[], interests: [] as string[], verifiedOnly: false };

export function FiltersScreen({ navigation }: ScreenProps<'Filters'>) {
  const { data: me } = useMe();
  const toast = useToast();
  const update = useUpdatePreferences();
  const p = me?.preferences ?? DEFAULTS;
  const [ages, setAges] = useState<[number, number]>([p.ageMin, p.ageMax]);
  const [distance, setDistance] = useState(p.maxDistance);
  const [intentions, setIntentions] = useState<Intention[]>(p.intentions);
  const [interests, setInterests] = useState<string[]>(p.interests);
  const [verifiedOnly, setVerifiedOnly] = useState(p.verifiedOnly);
  const idx = DISTANCES.indexOf(distance) >= 0 ? DISTANCES.indexOf(distance) : 4;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const apply = async () => {
    try {
      await update.mutateAsync({ ageMin: ages[0], ageMax: ages[1], maxDistance: distance, intentions, interests, verifiedOnly });
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Filters not saved', message: (e as Error).message });
    }
  };

  const reset = () => {
    setAges([DEFAULTS.ageMin, DEFAULTS.ageMax]);
    setDistance(DEFAULTS.maxDistance);
    setIntentions([]);
    setInterests([]);
    setVerifiedOnly(false);
  };

  return (
    <Screen
      edges={['top']}
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Reset" variant="secondary" onPress={reset} />
          </View>
          <View style={{ flex: 2 }}>
            <Button title="Apply filters" onPress={apply} loading={update.isPending} />
          </View>
        </View>
      }
    >
      <Header
        title="Discover preferences"
        subtitle="Shape who shows up for you."
        right={<IconButton icon="close" label="Close filters" onPress={() => navigation.goBack()} />}
      />

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="label" color="textSecondary">
            Age
          </Txt>
          <Txt variant="bodyStrong" color="gold">
            {ages[0]}–{ages[1] >= 99 ? '99+' : ages[1]}
          </Txt>
        </View>
        <RangeSlider min={18} max={99} low={ages[0]} high={ages[1]} onChange={(l, h) => setAges([l, h])} label="Age range" />
      </View>

      <View style={{ gap: 6, marginTop: space.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="label" color="textSecondary">
            Distance
          </Txt>
          <Txt variant="bodyStrong" color="gold">
            {distanceLabel(distance)}
          </Txt>
        </View>
        <RangeSlider min={0} max={DISTANCES.length - 1} low={idx} onChange={(l) => setDistance(DISTANCES[l])} label="Distance" formatValue={(i) => distanceLabel(DISTANCES[i])} />
      </View>

      <View style={{ marginTop: space.xl, gap: 10 }}>
        <Txt variant="label" color="textSecondary">
          Looking for
        </Txt>
        <ChipGroup>
          {FILTER_INTENTIONS.map((o) => (
            <Chip key={o.value} label={o.label} selected={intentions.includes(o.value)} onPress={() => setIntentions((s) => toggle(s, o.value))} />
          ))}
          <Chip label="Open to anything" selected={!intentions.length} onPress={() => setIntentions([])} />
        </ChipGroup>
      </View>

      <View style={{ marginTop: space.xl, gap: 10 }}>
        <Txt variant="label" color="textSecondary">
          Interests
        </Txt>
        <ChipGroup>
          {FILTER_INTERESTS.map((i) => (
            <Chip key={i} label={i} selected={interests.includes(i)} onPress={() => setInterests((s) => toggle(s, i))} />
          ))}
        </ChipGroup>
        <Txt variant="small" color="textMuted">
          {interests.length ? 'Showing people who share at least one of these.' : 'No interest filter — everyone’s welcome.'}
        </Txt>
      </View>

      <Group style={{ marginTop: space.xl }}>
        <ListRow title="Verified members only" subtitle="Only show people who completed verification" icon="shield-checkmark-outline" iconTone="gold" toggle={{ value: verifiedOnly, onChange: setVerifiedOnly }} last />
      </Group>
    </Screen>
  );
}
