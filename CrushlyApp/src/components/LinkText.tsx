import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Only two schemes are ever allowed through: a page that isn't http(s) isn't a page. */
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
 * A link somebody put in a Flow, a Vibe or a Moment opens in our own preview
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
  const parts = React.useMemo(() => String(text ?? '').split(URL_RE), [text]);
  const matches = React.useMemo(() => String(text ?? '').match(URL_RE) ?? [], [text]);

  if (!matches.length) {
    if (bare) return <>{text}</>;
    return (
      <Txt variant={variant} color={color} style={style} numberOfLines={numberOfLines}>
        {text}
      </Txt>
    );
  }

  // split() drops the links and match() keeps them, so the two are woven back
  // together: chunk, link, chunk, link — never one without the other.
  const nodes: React.ReactNode[] = [];
  parts.forEach((chunk, i) => {
    if (chunk) nodes.push(<React.Fragment key={`t-${i}`}>{chunk}</React.Fragment>);
    const url = matches[i];
    if (!url) return;
    if (isSafeWebUrl(url)) {
      // No variant: the link takes its type from the text around it, and only
      // the colour marks it out as something you can press.
      nodes.push(
        <Txt
          key={`l-${i}`}
          color={linkColor}
          onPress={() => navigation.navigate('WebPreview', { url })}
          accessibilityRole="link"
          accessibilityLabel={`Open link to ${prettyUrl(url)} inside Crushly`}
        >
          {prettyUrl(url)}
        </Txt>,
      );
    } else {
      // Not http(s), so it is not offered as a link at all.
      nodes.push(<React.Fragment key={`r-${i}`}>{url}</React.Fragment>);
    }
  });

  if (bare) return <>{nodes}</>;

  return (
    <Txt variant={variant} color={color} style={style} numberOfLines={numberOfLines}>
      {nodes}
    </Txt>
  );
}
