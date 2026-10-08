import React, { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { CrushlyMark } from '../../components/Logo';
import * as service from '../../api/service';
import { ApiError, configProblem, isConfigured } from '../../api/client';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO_LOGIN === '1';

function NotConfiguredNotice() {
  const { colors } = useTheme();
  const badUrl = configProblem === 'bad-url';
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: 14, padding: 14, marginBottom: space.md }}
    >
      <Ionicons name="link-outline" size={20} color={colors.gold} />
      <View style={{ flex: 1 }}>
        <Txt variant="smallStrong">{badUrl ? 'Supabase URL looks wrong' : 'Backend not connected'}</Txt>
        <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
          {badUrl
            ? 'EXPO_PUBLIC_SUPABASE_URL should be the bare Project URL — https://<ref>.supabase.co — with nothing after it (not /rest/v1, not a connection string). Fix it in Netlify: Site settings → Environment variables, then clear-cache redeploy.'
            : 'This build has no Supabase project behind it yet. In Netlify: Site settings → Environment variables → add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then redeploy. The README walks through the whole setup.'}
        </Txt>
      </View>
    </View>
  );
}

function Banner({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 14, marginBottom: space.md }}
    >
      <Ionicons name="alert-circle" size={20} color={colors.danger} />
      <Txt variant="small" style={{ flex: 1 }}>
        {message}
      </Txt>
    </View>
  );
}

export function SignInScreen({ navigation }: ScreenProps<'SignIn'>) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async (e = email, p = password) => {
    if (!e.trim() || !p) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(e.trim(), p);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <Screen keyboard footer={<Button title="Sign in" onPress={() => submit()} loading={loading} />}>
      <Header back />
      <CrushlyMark size={44} />
      <Txt variant="display" style={{ marginTop: space.md }} accessibilityRole="header">
        Welcome back
      </Txt>
      <Txt variant="body" color="textSecondary" style={{ marginTop: 4, marginBottom: space.xl }}>
        Good to see you again.
      </Txt>
      {!isConfigured ? <NotConfiguredNotice /> : null}
      {error ? <Banner message={error} /> : null}
      <View style={{ gap: space.md }}>
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          icon="mail-outline"
        />
        <Input
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => submit()}
          icon="lock-closed-outline"
        />
      </View>
      <Pressable onPress={() => navigation.replace('SignUp')} accessibilityRole="link" style={{ marginTop: space.lg, alignSelf: 'center', padding: 8 }}>
        <Txt variant="small" color="textSecondary">
          New here? <Txt variant="smallStrong" color="gold">Create an account</Txt>
        </Txt>
      </Pressable>
      {DEMO_ENABLED ? (
        <View style={{ marginTop: space.xl }}>
          <Button
            title="Explore the demo community"
            variant="outline"
            size="md"
            icon="sparkles-outline"
            onPress={() => {
              setEmail('daniel@crushly.app');
              setPassword('crushly123');
              submit('daniel@crushly.app', 'crushly123');
            }}
            accessibilityHint="Signs in as Daniel, a demo member with crushes and conversations"
          />
          <Txt variant="small" color="textMuted" align="center" style={{ marginTop: 8 }}>
            Signs in as Daniel, a demo member. Every demo profile is fictional.
          </Txt>
        </View>
      ) : null}
    </Screen>
  );
}

export function SignUpScreen({ navigation }: ScreenProps<'SignUp'>) {
  const { colors } = useTheme();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; adult?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const passwordRef = useRef<TextInput>(null);

  const strength = password.length === 0 ? null : password.length < 8 ? 'Too short' : /[0-9]/.test(password) && /[A-Za-z]/.test(password) && password.length >= 10 ? 'Strong' : 'Good';

  const submit = async () => {
    const next: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    if (!adult) next.adult = 'Please confirm you’re 18 or older.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      await signUp(email.trim(), password);
    } catch (err) {
      // Supabase asks the member to confirm their email before the first sign-in.
      if (err instanceof ApiError && err.status === 202) {
        setSentTo(email.trim().toLowerCase());
        setLoading(false);
        return;
      }
      setErrors({ form: (err as Error).message });
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <Screen footer={<Button title="Back to sign in" onPress={() => navigation.replace('SignIn')} />}>
        <Header back />
        <CrushlyMark size={44} />
        <Txt variant="display" style={{ marginTop: space.md }} accessibilityRole="header">
          Check your inbox
        </Txt>
        <Txt variant="body" color="textSecondary" style={{ marginTop: 8 }}>
          We sent a confirmation link to{' '}
          <Txt variant="bodyStrong">{sentTo}</Txt>. Open it on this device to activate your account — you’ll
          be signed in automatically.
        </Txt>
        <View style={{ marginTop: space.xl, gap: space.sm }}>
          <Button
            title={resent === 'done' ? 'Email sent again' : 'Resend email'}
            variant="outline"
            size="md"
            icon="mail-outline"
            loading={resent === 'busy'}
            onPress={async () => {
              setResent('busy');
              try {
                await service.resendConfirmation(sentTo);
                setResent('done');
              } catch {
                setResent('error');
              }
            }}
          />
          {resent === 'error' ? (
            <Txt variant="small" color="danger" align="center">
              Couldn’t resend just now — wait a minute and try again.
            </Txt>
          ) : (
            <Txt variant="small" color="textMuted" align="center">
              No email after a minute? Check spam, or resend.
            </Txt>
          )}
        </View>
        <Txt variant="small" color="textMuted" style={{ marginTop: space.lg }}>
          Wrong address? Go back and create your account again with the right one.
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen keyboard footer={<Button title="Create account" onPress={submit} loading={loading} />}>
      <Header back />
      <CrushlyMark size={44} />
      <Txt variant="display" style={{ marginTop: space.md }} accessibilityRole="header">
        Create your account
      </Txt>
      <Txt variant="body" color="textSecondary" style={{ marginTop: 4, marginBottom: space.xl }}>
        Your email stays private. It’s never shown on your profile.
      </Txt>
      {!isConfigured ? <NotConfiguredNotice /> : null}
      {errors.form ? <Banner message={errors.form} /> : null}
      <View style={{ gap: space.md }}>
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          icon="mail-outline"
          error={errors.email}
        />
        <Input
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          icon="lock-closed-outline"
          error={errors.password}
          hint={strength ? `Strength: ${strength}` : 'Use 8+ characters. A mix of letters and numbers is stronger.'}
        />
      </View>
      <Pressable
        onPress={() => setAdult((a) => !a)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: adult }}
        accessibilityLabel="I’m 18 or older and agree to the Terms and Community Guidelines"
        style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: space.xl, paddingVertical: 4 }}
      >
        <View
          style={{
            width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: adult ? colors.gold : colors.borderStrong,
            backgroundColor: adult ? colors.gold : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1,
          }}
        >
          {adult ? <Ionicons name="checkmark" size={16} color={colors.onGold} /> : null}
        </View>
        <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
          I’m 18 or older and I agree to the Terms and Community Guidelines.
        </Txt>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: space.md, marginLeft: 36, marginTop: 2 }}>
        <Pressable onPress={() => navigation.navigate('Info', { page: 'terms' })} accessibilityRole="link" hitSlop={8} style={{ paddingVertical: 6 }}>
          <Txt variant="smallStrong" color="gold">
            Read the Terms
          </Txt>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Info', { page: 'guidelines' })} accessibilityRole="link" hitSlop={8} style={{ paddingVertical: 6 }}>
          <Txt variant="smallStrong" color="gold">
            Community Guidelines
          </Txt>
        </Pressable>
      </View>
      {errors.adult ? (
        <Txt variant="small" color="danger" style={{ marginTop: 6 }}>
          {errors.adult}
        </Txt>
      ) : null}
      <Pressable onPress={() => navigation.replace('SignIn')} accessibilityRole="link" style={{ marginTop: space.lg, alignSelf: 'center', padding: 8 }}>
        <Txt variant="small" color="textSecondary">
          Already a member? <Txt variant="smallStrong" color="gold">Sign in</Txt>
        </Txt>
      </Pressable>
    </Screen>
  );
}
