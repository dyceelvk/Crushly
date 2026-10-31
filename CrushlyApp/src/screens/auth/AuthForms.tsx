import React, { useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthScaffold, AuthSwitch } from '../../components/AuthScaffold';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import * as service from '../../api/service';
import { useAuthProviders } from '../../api/providers';
import { sanitizeOtp, passwordStrength } from '../../lib/auth';
import { ApiError, configProblem, isConfigured } from '../../api/client';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { HIT, rhythm, space, stroke } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO_LOGIN === '1';

/**
 * "Continue with Google", shown only when the project has the provider on.
 *
 * It is the one sign-in path with no email in it: nothing to rate-limit, nothing
 * to land in spam, and the address comes back already verified. Placed above the
 * form because it is the shorter road, and separated by a plain "or" so the two
 * routes read as alternatives rather than a stack of buttons.
 */
function GoogleOption({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Button
        title="Continue with Google"
        variant="outline"
        size="md"
        icon="logo-google"
        onPress={onPress}
        loading={busy}
        accessibilityHint="Signs in with your Google account, no email code needed"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ flex: 1, height: stroke.hairline, backgroundColor: colors.border }} />
        <Txt variant="caption" color="textMuted">
          or use your email
        </Txt>
        <View style={{ flex: 1, height: stroke.hairline, backgroundColor: colors.border }} />
      </View>
    </View>
  );
}

/** The Google handler plus the "is it even on" question, in one place. */
function useGoogleSignIn(setError: (m: string | null) => void) {
  const { signInWithGoogle } = useAuth();
  const providers = useAuthProviders();
  const [busy, setBusy] = useState(false);
  const enabled = Platform.OS === 'web' && Boolean(providers.data?.google);
  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      // On success the browser is already leaving for Google.
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return { enabled, busy, start };
}

function NotConfiguredNotice() {
  const { colors } = useTheme();
  const badUrl = configProblem === 'bad-url';
  const secretKey = configProblem === 'secret-key';
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: 14, padding: 14, marginBottom: space.md }}
    >
      <Ionicons name="link-outline" size={20} color={colors.gold} />
      <View style={{ flex: 1 }}>
        <Txt variant="smallStrong">
          {secretKey ? 'Wrong Supabase key — secret key detected' : badUrl ? 'Supabase URL looks wrong' : 'Backend not connected'}
        </Txt>
        <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
          {secretKey
            ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY holds the SECRET key (sb_secret_… or service_role) — that one bypasses all security and must never ship in the app. Supabase → Settings → API Keys → copy the Publishable key (or the legacy anon public key) instead.'
            : badUrl
              ? 'EXPO_PUBLIC_SUPABASE_URL should be the bare Project URL — https://<ref>.supabase.co — with nothing after it (not /rest/v1, not a connection string). Fix it in Netlify: Site settings → Environment variables, then clear-cache redeploy.'
              : 'This build has no Supabase project behind it yet. In Netlify: Site settings → Environment variables → add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then redeploy. On a deploy-preview URL, also make sure both variables apply to Deploy Previews (Netlify scopes env vars per deploy context — a Production-only value leaves previews disconnected). The README walks through the whole setup.'}
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
  const google = useGoogleSignIn(setError);

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
    <AuthScaffold
      title="Welcome back"
      lede="Sign in to pick up where you left off."
      cta={<Button title="Sign in" onPress={() => submit()} loading={loading} />}
      footnote={<AuthSwitch lead="New here?" action="Create an account" onPress={() => navigation.replace('SignUp')} />}
    >
      {!isConfigured ? <NotConfiguredNotice /> : null}
      {error ? <Banner message={error} /> : null}
      {google.enabled ? (
        <View style={{ marginBottom: rhythm.group }}>
          <GoogleOption onPress={() => void google.start()} busy={google.busy} />
        </View>
      ) : null}
      <View style={{ gap: rhythm.group }}>
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
        <View>
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
          {/* Recovery belongs to the password field, so it sits under it and
              aligns to the far edge — reading distance, not a centred chip
              competing with the form. */}
          <Pressable
            onPress={() => navigation.navigate('ForgotPassword')}
            accessibilityRole="link"
            accessibilityLabel="Forgot your password? Reset it"
            hitSlop={HIT / 2}
            style={({ pressed }) => ({
              alignSelf: 'flex-end',
              minHeight: HIT,
              justifyContent: 'center',
              paddingHorizontal: 4,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Txt variant="smallStrong" color="gold">
              Forgot your password?
            </Txt>
          </Pressable>
        </View>
      </View>
      {DEMO_ENABLED ? (
        <View style={{ marginTop: rhythm.section }}>
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
    </AuthScaffold>
  );
}

export function SignUpScreen({ navigation }: ScreenProps<'SignUp'>) {
  const { colors } = useTheme();
  const { signUp, verifySignupOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; adult?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [mode, setMode] = useState<'choose' | 'code'>('choose');
  const [linkState, setLinkState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const passwordRef = useRef<TextInput>(null);
  const google = useGoogleSignIn((m) => setErrors(m ? { form: m } : {}));

  const strength = passwordStrength(password);

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

  const submitCode = async (c: string) => {
    if (c.length !== 6 || verifying || !sentTo) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      await verifySignupOtp(sentTo, c);
      // Success flips auth state to onboarding/ready — the navigator takes over.
    } catch (err) {
      setVerifyError((err as Error).message);
      setVerifying(false);
    }
  };

  const sendLink = async () => {
    if (!sentTo || linkState === 'busy') return;
    setLinkState('busy');
    try {
      await service.resendConfirmation(sentTo);
      setLinkState('done');
    } catch {
      setLinkState('error');
    }
  };

  if (sentTo) {
    return (
      <AuthScaffold
        title="Check your inbox"
        lede={
          <>
            We sent a code and a link to <Txt variant="bodyStrong">{sentTo}</Txt>. Use whichever you
            prefer — you’ll be signed in automatically either way.
          </>
        }
        cta={
          mode === 'code' ? (
            <Button title="Verify & continue" onPress={() => void submitCode(code)} loading={verifying} disabled={code.length !== 6} />
          ) : undefined
        }
        footnote={<AuthSwitch lead="Wrong address?" action="Go back to sign in" onPress={() => navigation.replace('SignIn')} />}
      >

        {mode === 'choose' ? (
          <View style={{ gap: space.sm }}>
            <Button title="Verify with code" icon="keypad-outline" onPress={() => setMode('code')} />
            <Button title="Get a link" variant="outline" icon="link-outline" loading={linkState === 'busy'} onPress={() => void sendLink()} />
            {linkState === 'done' ? (
              <Txt variant="small" color="gold" align="center" style={{ marginTop: 4 }}>
                Link sent! Open the newest email and tap “Confirm my email”.
              </Txt>
            ) : linkState === 'error' ? (
              <Txt variant="small" color="danger" align="center">
                Couldn’t send just now — wait a minute and try again.
              </Txt>
            ) : (
              <Txt variant="small" color="textMuted" align="center">
                The code is fastest. The link works great from your phone.
              </Txt>
            )}
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: colors.goldSoft,
                borderRadius: 16,
                borderWidth: 1.5,
                borderColor: code.length ? colors.gold : colors.goldSoft,
              }}
            >
              <TextInput
                value={code}
                onChangeText={(t) => {
                  const c = sanitizeOtp(t);
                  setCode(c);
                  setVerifyError(null);
                  if (c.length === 6) void submitCode(c);
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Confirmation code"
                autoFocus
                style={{
                  textAlign: 'center',
                  fontSize: 30,
                  fontWeight: '800',
                  letterSpacing: 10,
                  color: colors.text,
                  paddingVertical: 16,
                }}
              />
            </View>
            {verifyError ? (
              <Txt variant="small" color="danger" align="center" style={{ marginTop: space.sm }}>
                {verifyError}
              </Txt>
            ) : null}
            <View style={{ marginTop: space.lg, gap: space.sm }}>
              <Button title="Get a link instead" variant="outline" icon="link-outline" loading={linkState === 'busy'} onPress={() => void sendLink()} />
              {linkState === 'done' ? (
                <Txt variant="small" color="gold" align="center">
                  Link sent! Open the newest email and tap “Confirm my email”.
                </Txt>
              ) : linkState === 'error' ? (
                <Txt variant="small" color="danger" align="center">
                  Couldn’t send just now — wait a minute and try again.
                </Txt>
              ) : (
                <Txt variant="small" color="textMuted" align="center">
                  No code? We can email a link instead.
                </Txt>
              )}
            </View>
          </>
        )}

      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      eyebrow="Step 1 of 2"
      title="Create your account"
      lede="Your email stays private. It’s never shown on your Space."
      cta={<Button title="Create account" onPress={submit} loading={loading} />}
      footnote={
        <>
          <AuthSwitch lead="Already a member?" action="Sign in" onPress={() => navigation.replace('SignIn')} />
          {/* Legal links used to sit between the password field and the
              checkbox, where two bright cyan links competed with the form. They
              belong at the very bottom, in the quiet colour, as one line. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
            <Pressable onPress={() => navigation.navigate('Info', { page: 'terms' })} accessibilityRole="link" hitSlop={12}>
              <Txt variant="small" color="textMuted">Terms</Txt>
            </Pressable>
            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textMuted }} />
            <Pressable onPress={() => navigation.navigate('Info', { page: 'guidelines' })} accessibilityRole="link" hitSlop={12}>
              <Txt variant="small" color="textMuted">Community Guidelines</Txt>
            </Pressable>
          </View>
        </>
      }
    >
      {!isConfigured ? <NotConfiguredNotice /> : null}
      {errors.form ? <Banner message={errors.form} /> : null}
      <View style={{ gap: rhythm.group }}>
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
        style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: rhythm.group, paddingVertical: 4 }}
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
      {errors.adult ? (
        <Txt variant="small" color="danger" style={{ marginTop: 6 }}>
          {errors.adult}
        </Txt>
      ) : null}
    </AuthScaffold>
  );
}

export function ForgotPasswordScreen({ navigation }: ScreenProps<'ForgotPassword'>) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState<'choose' | 'code'>('choose');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const { setNewPassword } = useAuth();

  const send = async (target = email) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(target.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await service.sendPasswordReset(target);
      setSentTo(target.trim().toLowerCase());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveWithCode = async () => {
    if (!sentTo) return;
    if (code.length !== 6) return setError('Enter the 6-digit code from your email.');
    if (password.length < 8) return setError('Use at least 8 characters for your new password.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setError(null);
    setBusy(true);
    try {
      await service.verifyRecoveryOtp(sentTo, code);
      await setNewPassword(password);
      // Success flips auth state — the navigator takes over.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthScaffold
        title="Check your inbox"
        lede={
          <>
            We sent a code and a link to <Txt variant="bodyStrong">{sentTo}</Txt>. Use whichever you
            prefer to set a new password.
          </>
        }
        onBack={() => navigation.replace('SignIn')}
        cta={
          mode === 'code' ? (
            <Button title="Save new password" onPress={() => void saveWithCode()} loading={busy} />
          ) : undefined
        }
        footnote={<AuthSwitch lead="Remembered it?" action="Back to sign in" onPress={() => navigation.replace('SignIn')} />}
      >
        {mode === 'choose' ? (
          <View style={{ gap: space.sm }}>
            <Button title="Verify with code" icon="keypad-outline" onPress={() => setMode('code')} />
            <Button
              title="Get a link"
              variant="outline"
              icon="link-outline"
              loading={linkState === 'busy'}
              onPress={async () => {
                setLinkState('busy');
                try {
                  await service.sendPasswordReset(sentTo);
                  setLinkState('done');
                } catch {
                  setLinkState('error');
                }
              }}
            />
            {linkState === 'done' ? (
              <Txt variant="small" color="gold" align="center">
                Link sent! Open the newest email and tap “Reset my password”.
              </Txt>
            ) : linkState === 'error' ? (
              <Txt variant="small" color="danger" align="center">
                Couldn’t send just now — wait a minute and try again.
              </Txt>
            ) : (
              <Txt variant="small" color="textMuted" align="center">
                The code is fastest. The link works great from your phone.
              </Txt>
            )}
          </View>
        ) : (
          <>
            {error ? <Banner message={error} /> : null}
            <View style={{ gap: rhythm.group }}>
              <Input
                label="Code from your email"
                value={code}
                onChangeText={(t) => setCode(sanitizeOtp(t))}
                placeholder="000000"
                keyboardType="number-pad"
                inputMode="numeric"
                textContentType="oneTimeCode"
                maxLength={6}
                icon="keypad-outline"
              />
              <Input
                label="New password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                icon="lock-closed-outline"
              />
              <Input
                label="Repeat new password"
                value={confirm}
                onChangeText={setConfirm}
                placeholder="One more time"
                secureTextEntry
                autoComplete="new-password"
                icon="lock-closed-outline"
              />
            </View>
          </>
        )}

      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Reset your password"
      lede="Tell us the email you signed up with and we’ll send a code and a link to set a new password."
      onBack={() => navigation.replace('SignIn')}
      cta={<Button title="Send reset email" onPress={() => void send()} loading={busy} />}
      footnote={<AuthSwitch lead="Remembered it?" action="Back to sign in" onPress={() => navigation.replace('SignIn')} />}
    >
      {error ? <Banner message={error} /> : null}
      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        icon="mail-outline"
      />
    </AuthScaffold>
  );
}

export function SetPasswordScreen() {
  const { setNewPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (password.length < 8) return setError('Use at least 8 characters for your new password.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setError(null);
    setBusy(true);
    try {
      await setNewPassword(password);
      // Success flips auth state — the navigator takes over.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthScaffold
      hideBack
      title="Choose a new password"
      lede="You’re signed in — just pick a new password and you’re back in."
      cta={<Button title="Save new password" onPress={() => void save()} loading={busy} />}
    >
      {error ? <Banner message={error} /> : null}
      <View style={{ gap: rhythm.group }}>
        <Input
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          icon="lock-closed-outline"
        />
        <Input
          label="Repeat new password"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="One more time"
          secureTextEntry
          autoComplete="new-password"
          icon="lock-closed-outline"
        />
      </View>
    </AuthScaffold>
  );
}
