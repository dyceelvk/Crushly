import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState } from './States';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The last line of defence between a bad render and a blank white page.
 *
 * A thrown error during render unmounts the whole React tree, and what is left is
 * the page behind it: no navigation, no retry, no way back but the OS. That is
 * exactly what opening another person's Space did — `Cannot read properties of
 * undefined (reading 'length')` — and it is the worst possible failure, because
 * the member cannot even tell whether the app is loading or broken.
 *
 * A boundary cannot fix the bug, but it converts an unrecoverable page into a
 * recoverable one: a sentence, and a button that remounts the tree.
 *
 * Kept deliberately small. It catches render, lifecycle and constructor errors in
 * what it wraps; it does not catch async work (that is what `ErrorState` on a
 * query is for) or event-handler errors (those surface as a toast).
 */

type Props = { children: React.ReactNode; title?: string };
type State = { error: unknown; attempt: number };

/** The fallback, with the app's own background — a screen-less View is page-white. */
function ErrorFallback({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="render-fallback"
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingHorizontal: 20, justifyContent: 'center' }}
    >
      <ErrorState
        title={title}
        error={error}
        message="This screen hit a problem it couldn’t get past. Try again — if it keeps happening, restart Crushly."
        onRetry={onRetry}
      />
    </View>
  );
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // The detail belongs in the console, not in the UI.
    console.error('[Crushly] render failed', error, info?.componentStack);
  }

  // A new attempt key remounts the children rather than reusing the broken tree.
  reset = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    if (!this.state.error) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    return <ErrorFallback title={this.props.title ?? 'Something broke on this screen'} error={this.state.error} onRetry={this.reset} />;
  }
}
