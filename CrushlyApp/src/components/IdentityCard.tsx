import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, space, type } from '../theme/tokens';
import { identityLine, publicIdentityLine } from '../lib/identity';
import { useMemberIdentity, useMyIdentity, useSetIdentityVisible } from '../api/hooks';
import type { MyIdentity } from '../api/service';
import { useToast } from './Toast';

/**
 * HolUpp Identity on a Space.
 *
 * This is not a card and not a badge. The brief is explicit — minimal, existing
 * type and colour, no big surface, no animation — so it is a heading in the
 * house label style and one line beneath it, sitting in the Space's own flow.
 * Nothing here is pressable except the one control on your own Space; an
 * identity is not a link, a level, or a reward to open.
 *
 * Two viewers, one component:
 *   * `mine` — your own Space. You always see your identity here, even while
 *     developing, and even if you have hidden it from everybody else. Hiding
 *     yourself from strangers is not hiding from yourself.
 *   * otherwise — a visitor. If the member hid it, or has not been classified
 *     yet, this renders nothing at all. Not a placeholder, not "Private": an
 *     absent line, so a visitor cannot even tell whether there is one.
 */
export function IdentityCard({
  keys,
  mine = false,
  developing = false,
  hidden = false,
  onToggleVisible,
}: {
  /** The published identity/identities, else empty. */
  keys: readonly unknown[] | null | undefined;
  mine?: boolean;
  /** True when the backend has classified this member yet. */
  developing?: boolean;
  /** True when the member has switched public visibility off. */
  hidden?: boolean;
  /** Your own Space only: show/hide from other people. */
  onToggleVisible?: (visible: boolean) => void;
}) {
  const { colors } = useTheme();

  const line = mine
    ? identityLine(developing ? [] : keys)
    : publicIdentityLine(keys, !hidden);

  if (!line) return null;

  return (
    <View style={styles.wrap}>
      {/* The heading is the brand's own colour rather than a grey label.
          Design 04 sets "YOUR HOlUPP IDENTITY" in hot pink caps on its own line
          above the name of the identity, and that is doing real work: it is the
          only place on the page that says a classification came from HolUpp
          rather than from the member, so it should not read as chrome. It is
          still the same sentence in the same place — the words are untouched. */}
      <Text
        style={[type.label, { color: colors.gold, marginBottom: space.xs }]}
        accessibilityRole="header"
      >
        {line.heading}
      </Text>

      <Text style={[styles.title, { color: colors.text }]}>
        {line.emoji ? <Text style={{ color: colors.primary }}>{line.emoji} </Text> : null}
        {line.title}
      </Text>

      {/* The epithet only once there is something to describe. "Your identity is
          still developing" is a complete sentence; it does not need a subtitle. */}
      {line.epithet ? (
        <Text style={[type.accent, { color: colors.textSecondary, marginTop: 2 }]}>
          {line.epithet}
        </Text>
      ) : null}

      {/* Owner-only, and only once there is a choice worth making. Offering
          "hide" to somebody with no identity yet would be a control over
          nothing. */}
      {mine && !line.developing && onToggleVisible ? (
        <Pressable
          onPress={() => onToggleVisible(hidden)}
          hitSlop={10}
          accessibilityRole="switch"
          accessibilityState={{ checked: !hidden }}
          accessibilityLabel={hidden ? 'Show my identity on my Space' : 'Hide my identity from other people'}
          style={styles.toggle}
        >
          <Text style={[type.small, { color: colors.textMuted }]}>
            {hidden ? 'Hidden from other people · Tap to show' : 'Visible to other people · Tap to hide'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  title: {
    ...type.title,
    // Fraunces is the display face; the title is the one line on the page that
    // earns it.
    fontFamily: fonts.display,
  },
  toggle: {
    marginTop: space.sm,
    alignSelf: 'flex-start',
    paddingVertical: space.xs,
  },
});

/**
 * The data-bound half.
 *
 * Kept in the same file as the presentation so the whole feature is one import:
 * the component above has no knowledge of the server, and this has no styling of
 * its own.
 *
 * On your own Space it reads `holupp_identity_mine` — the only endpoint that
 * returns scores, and it returns only yours. Visiting somebody reads
 * `holupp_identity_public`, which cannot return a number at all.
 *
 * Failure is silent by design. If the engine is disabled, mid-migration, or the
 * request simply fails, this renders `null`: no identity line, no error, no
 * skeleton left behind. A profile must never depend on classification working.
 */
export function IdentitySection({ memberId, mine = false }: { memberId: number; mine?: boolean }) {
  // Both hooks always run; `enabled` decides which one is actually asked, which
  // keeps hook order identical on your Space and somebody else's.
  const own = useMyIdentity(mine);
  const other = useMemberIdentity(memberId, !mine);
  const toggle = useSetIdentityVisible();
  const toast = useToast();

  const data = mine ? own.data : other.data;
  if (!data) return null;

  // A visitor is told nothing when the member hid it: `publicIdentityLine`
  // returns null and so does this component.
  const keys = mine
    ? ((data as MyIdentity).identity ? [(data as MyIdentity).identity, ...((data as MyIdentity).co_primary ?? [])] : [])
    : ((data as { identity: string | null; co_primary: string[] }).identity
        ? [(data as { identity: string }).identity!, ...((data as { co_primary: string[] }).co_primary ?? [])]
        : []);

  return (
    <IdentityCard
        keys={keys}
        mine={mine}
        developing={mine ? Boolean((data as MyIdentity).developing) : false}
        hidden={mine ? (data as MyIdentity).visible === false : false}
        onToggleVisible={
          mine
            ? (visible) => {
                toggle.mutate(visible, {
                  onSuccess: (res) =>
                    toast({ kind: 'success', title: res.visible ? 'Visible again' : 'Hidden' }),
                  // Hiding is a preference, not a transaction: a failure here
                  // must not accuse the member of anything.
                  onError: () => toast({ kind: 'error', title: 'Couldn’t change that just now' }),
                });
              }
            : undefined
        }
    />
  );
}
