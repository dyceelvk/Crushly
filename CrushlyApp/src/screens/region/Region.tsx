import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { declareRegion, regionStatus, setRegionSharing } from '../../api/service';
import { reportRegion } from '../../lib/region';
import { useTheme } from '../../theme/ThemeProvider';
import { useLayout } from '../../components/Layout';
import type { ScreenProps } from '../../navigation/types';

/**
 * Where you are.
 *
 * Two separate things, and the screen is built so they cannot be confused:
 *
 *  * **Detection is required.** It is what makes the Control Centre's countries,
 *    its regional analytics and its fraud checks true rather than empty. It is
 *    measured server-side from the connection — the app never says where it is,
 *    so a member cannot assert a country to a detector.
 *
 *  * **Disclosure is not.** Knowing where somebody is and telling other members
 *    are different acts. The switch starts off and is the member's to turn on.
 *    Nothing on any other member's screen reads this unless they do.
 *
 * A failed lookup does not trap anybody: the screen offers the statement
 * instead, recorded as `DECLARED` so the difference survives.
 */

/** The countries a first pass offers. The full list lives behind the search. */
const COMMON: { code: string; name: string }[] = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Germany' },
];

export function RegionScreen({ navigation }: ScreenProps<'Region'>) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const status = useQuery({ queryKey: ['region', 'status'], queryFn: regionStatus });
  const [locating, setLocating] = useState(false);
  const [manual, setManual] = useState(false);
  const [failed, setFailed] = useState(false);

  // One detection attempt when the screen opens. The member is here because the
  // app needs a location, so the ordinary throttle does not apply.
  useEffect(() => {
    let alive = true;
    setLocating(true);
    (async () => {
      const result = await reportRegion('SENSITIVE_ACTION', { force: true });
      if (!alive) return;
      setLocating(false);
      if (!result?.identified) setFailed(true);
      await qc.invalidateQueries({ queryKey: ['region', 'status'] });
    })();
    return () => { alive = false; };
  }, [qc]);

  const declare = useMutation({
    mutationFn: (code: string) => declareRegion(code),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['region', 'status'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const share = useMutation({
    mutationFn: (on: boolean) => setRegionSharing(on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['region', 'status'] }),
  });

  const s = status.data;
  const located = Boolean(s?.located);
  const shared = Boolean(s?.shared);
  const busy = locating || status.isLoading;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + 18,
        paddingBottom: insets.bottom + 28,
        paddingHorizontal: gutter,
        alignItems: 'center',
      }}
    >
      <View style={{ width: contentWidth }}>
        <View style={styles.mark}>
          <Ionicons name="location" size={22} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Where you are</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          holUpp works out your country from the connection you are on. It takes a
          moment, once, and then it is done.
        </Text>

        {busy ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primaryLine }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.cardText, { color: colors.textSecondary }]}>Checking your connection…</Text>
          </View>
        ) : located ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primaryLine }]}>
            <View style={styles.cardHead}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success ?? colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {s?.method === 'DECLARED' ? 'You told us where you are' : 'Country identified'}
              </Text>
            </View>
            <Text style={[styles.cardText, { color: colors.textSecondary }]}>
              {s?.method === 'DECLARED'
                ? 'We could not read your connection, so your answer stands until it can be checked.'
                : 'This is stored on your account and is what the Control Centre uses. Your exact location is never shown to other members.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primaryLine }]}>
            <View style={styles.cardHead}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {failed ? 'We could not read your connection' : 'Not confirmed yet'}
              </Text>
            </View>
            <Text style={[styles.cardText, { color: colors.textSecondary }]}>
              That happens on a VPN, on some networks, or in a browser. Tell us where
              you are and carry on — it is recorded as your answer, not as a
              measurement.
            </Text>
            <Pressable
              onPress={() => {
                setManual(true);
                reportRegion('SENSITIVE_ACTION', { force: true });
              }}
              style={[styles.secondary, { borderColor: colors.primaryLine }]}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                {locating ? 'Checking…' : 'Try again, or choose your country'}
              </Text>
            </Pressable>
          </View>
        )}

        {manual || located ? (
          <View style={{ marginTop: 18 }}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Country</Text>
            <View style={styles.grid}>
              {COMMON.map((c) => {
                const active = s?.declared === c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => declare.mutate(c.code)}
                    style={[
                      styles.chip,
                      { borderColor: active ? colors.primary : colors.primaryLine, backgroundColor: active ? colors.primarySoft : 'transparent' },
                    ]}
                  >
                    <Text style={{ color: active ? colors.primary : colors.text, fontSize: 14 }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {declare.isError ? (
              <Text style={[styles.err, { color: colors.danger }]}>
                {(declare.error as Error)?.message ?? 'Could not save that.'}
              </Text>
            ) : null}
          </View>
        ) : null}

        {located ? (
          <View style={[styles.shareCard, { backgroundColor: colors.elevated, borderColor: colors.primaryLine }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Show my country on my Space</Text>
              <Text style={[styles.cardText, { color: colors.textSecondary }]}>
                Off means nobody sees it — not now, not ever, unless you change this.
                Your country is still used by holUpp itself. It is never shown as
                anything more precise than a country.
              </Text>
            </View>
            <Pressable
              onPress={() => share.mutate(!shared)}
              accessibilityRole="switch"
              accessibilityState={{ checked: shared }}
              style={[styles.switch, { backgroundColor: shared ? colors.primary : 'rgba(255,255,255,0.16)' }]}
            >
              <View style={[styles.knob, { alignSelf: shared ? 'flex-end' : 'flex-start' }]} />
            </Pressable>
          </View>
        ) : null}

        <Pressable
          disabled={!located}
          onPress={() => navigation.goBack()}
          style={[styles.primary, { backgroundColor: located ? colors.primary : 'rgba(255,255,255,0.10)' }]}
        >
          <Text style={[styles.primaryText, { color: located ? '#231024' : colors.textSecondary }]}>
            {located ? 'Continue' : 'Confirm your country to continue'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 16 },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  sub: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 20 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15.5, fontWeight: '600' },
  cardText: { fontSize: 13.5, lineHeight: 20 },
  label: { fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  err: { marginTop: 10, fontSize: 13 },
  secondary: { marginTop: 10, borderWidth: 1, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontSize: 14.5, fontWeight: '600' },
  shareCard: { marginTop: 18, borderWidth: 1, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 14, alignItems: 'center' },
  switch: { width: 52, height: 32, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff' },
  primary: { marginTop: 22, borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  primaryText: { fontSize: 15.5, fontWeight: '700' },
});
