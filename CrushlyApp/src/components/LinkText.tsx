import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import type { RootStackParamList } from '../navigation/types';
import { useToast } from './Toast';
import { profileIdByUsername } from '../api/service';
import { tokenize } from '../lib/links';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function isSafeWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** "https://example.com/a/b?c=1" → "example.com/a/b…" */
export function prettyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const tail = (u.pathname === '/' ? '' : u.pathname) + (u.search ? '?' + u.search.slice(1) : '');
    const shown = (u.host.replace(/^www\./, '') + tail).replace(/\/$/, '');
    return shown.length > 42 ? shown.slice(0, 41) + '…' : shown || u.host;
  } catch {
    return raw;
  }
}

/**
 * Text that may hold links — and links that stay inside Crushly.
 *
 * A link somebody put in a Flow or a Moment opens in our own preview
 * sheet. It never hands the member straight to Chrome, and nothing navigates
 * on its own: the member taps, sees which site it is, and decides from there
 * whether to open it in a real browser. The hostname is shown on every link,
 * because a link you cannot read is a link that can lie to you.
 */
export function LinkText({
  text,
  variant = 'body',
  color,
  style,
  numberOfLines,
  linkColor = 'gold',
  bare = false,
}: {
  text: string;
  variant?: any;
  color?: any;
  style?: any;
  numberOfLines?: number;
  linkColor?: any;
  /**
   * Render the pieces without a wrapper, so the text takes its size, colour
   * and line height from whatever it is already sitting inside. Use this when
   * dropping links into copy that is already styled — a Moment's caption, say.
   */
  bare?: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { parts, matches } = React.useMemo(() => tokenize(String(text ?? '')), [text]);

  if (!matches.length) {
    if (bare) return <>{text}</>;
    return (
      <Txt variant={variant} color={color} style={style} numberOfLines={numberOfLines}>
        {text}
      </Txt>
    );
  }

  // The text is woven back together: chunk, thing, chunk, thing — never one
  // without the other. A thing is a link, a handle, or a tag; everything else
  // is left exactly as it was typed.
  const nodes: React.ReactNode[] = [];
  parts.forEach((chunk, i) => {
    if (chunk) nodes.push(<React.Fragment key={`t-${i}`}>{chunk}</React.Fragment>);
    const m = matches[i];
    if (!m) return;

    if (m.kind === 'url') {
      if (isSafeWebUrl(m.text)) {
        // No variant: the link takes its type from the text around it, and only
        // the colour marks it out as something you can press.
        nodes.push(
          <Txt
            key={`l-${i}`}
            color={linkColor}
            onPress={() => navigation.navigate('WebPreview', { url: m.text })}
            accessibilityRole="link"
            accessibilityLabel={`Open link to ${prettyUrl(m.text)} inside Crushly`}
          >
            {prettyUrl(m.text)}
          </Txt>,
        );
      } else {
        // Not http(s), so it is not offered as a link at all.
        nodes.push(<React.Fragment key={`r-${i}`}>{m.text}</React.Fragment>);
      }
      return;
    }

    if (m.kind === 'mention') {
      nodes.push(<Mention key={`m-${i}`} handle={m.value} color={linkColor} />);
      return;
    }

    // A tag is a word, so it filters Search — the same search box, holding the
    // same word, rather than a second kind of search that only tags use.
    nodes.push(
      <Txt
        key={`h-${i}`}
        color={linkColor}
        onPress={() => navigation.navigate('Search', { q: `#${m.value}` })}
        accessibilityRole="link"
        accessibilityLabel={`See every post tagged ${m.value}`}
      >
        {`#${m.value}`}
      </Txt>,
    );
  });

  if (bare) return <>{nodes}</>;

  return (
    <Txt variant={variant} color={color} style={style} numberOfLines={numberOfLines}>
      {nodes}
    </Txt>
  );
}

/**
 * A name, and the Space behind it.
 *
 * The lookup happens on the press rather than on render: a feed of forty posts
 * mentioning forty people should not cost forty queries to draw, and the handle
 * is already readable without one. If nobody answers to it, the sentence says
 * so instead of opening an empty screen.
 */
function Mention({ handle, color }: { handle: string; color: any }) {
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await profileIdByUsername(handle);
      if (id === null) {
        toast({ kind: 'info', title: `No one here is @${handle}`, message: 'They may have changed their handle.' });
        return;
      }
      navigation.navigate('UserProfile', { id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open that Space', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Txt color={color} onPress={open} accessibilityRole="link" accessibilityLabel={`Open @${handle}’s Space`}>
      {`@${handle}`}
    </Txt>
  );
}
