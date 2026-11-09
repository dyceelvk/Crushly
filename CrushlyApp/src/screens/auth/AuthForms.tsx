import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthScaffold, AuthSwitch } from '../../components/AuthScaffold';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import * as service from '../../api/service';
import { useAuthProviders } from '../../api/providers';
import { emailSendMessage, sanitizeOtp, passwordStrength } from '../../lib/auth';
import { errorLine } from '../../lib/errors';
import { ApiError, isConfigured } from '../../api/client';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { HIT, rhythm, space, stroke } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO_LOGIN === '1';

/** Gmail confirmation codes and links are email/password verification, not OAuth.
 * Google authentication stays hidden until the product explicitly re-enables it.
 */
const GOOGLE_SIGN_IN_OFF = true;

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
  const enabled = !GOOGLE_SIGN_IN_OFF && Platform.OS === 'web' && Boolean(providers.data?.google);
  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      // On success the browser is already leaving for Google.
    } catch (err) {
      setError(errorLine(err));
      setBusy(false);
    }
  };
  return { enabled, busy, start };
}

function NotConfiguredNotice() {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: 14, padding: 14, marginBottom: space.md }}
    >
      <Ionicons name="cloud-offline-outline" size={20} color={colors.gold} />
      <View style={{ flex: 1 }}>
        <Txt variant="smallStrong">We can’t connect to Holup right now</Txt>
        <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
          Please try again in a little while.
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

/**
 * "Send it again" — one button, because there is one email.
 *
 * It used to be two: "Verify with code" and "Get a link", where the second sent
 * a brand-new mail. But the confirmation email already carries both a code and a
 * link, so asking for "a link" asked for something that had already arrived, and
 * paid for it out of a project-wide hourly budget that is small. What a person
 * actually needs at this point is the same mail again, or a way in without it.
 */
function SendAnother({
  busy,
  sent,
  cooldown,
  onPress,
}: {
  busy: boolean;
  sent: boolean;
  cooldown: number;
  onPress: () => void;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Button
        title={cooldown > 0 ? `Email me another (${cooldown}s)` : 'Email me another'}
        variant="outline"
        icon="mail-outline"
        loading={busy}
        disabled={cooldown > 0}
        onPress={onPress}
        accessibilityHint="Sends the same email again, with a fresh code and link"
      />
      <Txt variant="small" color={sent ? 'gold' : 'textMuted'} align="center">
        {sent
          ? 'Sent. The newest email is the one that works — the older codes stop counting.'
          : 'The email has both a 6-digit code and a link. It lasts an hour.'}
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
  /**
   * The address exists but was never confirmed.
   *
   * This is the state three of the first twelve accounts were left in: the
   * sign-up screen said "check your inbox", the code never came, and the way
   * back in said only that the email was unconfirmed. A message that describes
   * a dead end without opening it is the same as no message, so this flag puts
   * a real "send me a fresh code" beside it.
   */
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resending, setResending] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const google = useGoogleSignIn(setError);

  const submit = async (e = email, p = password) => {
    if (!e.trim() || !p) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setUnconfirmed(false);
    setLoading(true);
    try {
      await signIn(e.trim(), p);
    } catch (err) {
      setError(errorLine(err));
      setUnconfirmed(err instanceof ApiError && err.code === 'email-unconfirmed');
      setLoading(false);
    }
  };

  /** Send a fresh code and hand the address to the sign-up screen's code entry. */
  const sendFreshCode = async () => {
    const to = email.trim().toLowerCase();
    if (!to || resending) return;
    setResending(true);
    setError(null);
    try {
      await service.resendConfirmation(to);
      navigation.navigate('SignUp', { email: to });
    } catch (err) {
      setError(
        err instanceof ApiError && (err.isNetwork || err.status === 0)
          ? errorLine(err)
          : emailSendMessage(err instanceof Error ? err.message : ''),
      );
    } finally {
      setResending(false);
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
      {unconfirmed ? (
        <View style={{ marginBottom: rhythm.group }}>
          <Button
            title="Send me a fresh code"
            variant="outline"
            icon="mail-outline"
            loading={resending}
            onPress={() => void sendFreshCode()}
          />
          <Txt variant="small" color="textMuted" align="center" style={{ marginTop: space.xs }}>
            It goes to {email.trim() || 'your address'} and signs you in with a 6-digit code.
          </Txt>
        </View>
      ) : null}
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
          {/* No hitSlop here, deliberately.
              This link sits directly under the password field, and `hitSlop`
              grew its touch area 22 px in every direction — including upwards,
              over the bottom of the field. So the lower half of the password box
              was secretly the reset link: tap the field to type and you were
              carried off to "Forgot your password?". The link is already 44 pt
              tall on its own, which is the target size it needed. */}
          <Pressable
            onPress={() => navigation.navigate('ForgotPassword')}
            accessibilityRole="link"
            accessibilityLabel="Forgot your password? Reset it"
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

export function SignUpScreen({ navigation, route }: ScreenProps<'SignUp'>) {
  const { colors } = useTheme();
  const { signUp, verifySignupOtp } = useAuth();
  /**
   * A member can arrive here already holding an unconfirmed account: they signed
   * up, the code never reached them, and sign-in told them so. `email` is that
   * address — they land on the code entry with a code already on its way, not on
   * a "create your account" form that would refuse them.
   */
  const handed = route?.params?.email?.trim().toLowerCase() ?? '';
  const [email, setEmail] = useState(handed);
  const [password, setPassword] = useState('');
  const [ageEligible, setAgeEligible] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; ageEligible?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(handed || null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [mode, setMode] = useState<'choose' | 'code'>(handed ? 'code' : 'choose');
  const [linkState, setLinkState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  /**
   * When another email may be sent.
   *
   * GoTrue allows a small number of auth emails an hour for the whole project,
   * and every "send me another" spends one of them. Counting down on screen is
   * not decoration: it is what stops one impatient minute from using up the
   * afternoon for everybody.
   */
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]);
  const passwordRef = useRef<TextInput>(null);
  const google = useGoogleSignIn((m) => setErrors(m ? { form: m } : {}));

  const strength = passwordStrength(password);

  const submit = async () => {
    const next: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    if (!ageEligible) next.ageEligible = 'Please confirm you’re 16 or older.';
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
      setErrors({ form: errorLine(err) });
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
      setVerifyError(errorLine(err));
      setVerifying(false);
    }
  };

  /**
   * Send the confirmation email again — the same one, which carries both a code
   * and a link, so there is nothing to choose between two buttons. Rate limits
   * are per project, not per person, so a send is only offered when the last one
   * is a minute old, and the wait is counted on screen rather than refused after
   * the fact with "too many emails".
   */
  const sendAnother = async () => {
    if (!sentTo || linkState === 'busy' || cooldown > 0) return;
    setLinkState('busy');
    try {
      await service.resendConfirmation(sentTo);
      setLinkState('done');
      setCooldown(60);
    } catch (err) {
      setLinkState('error');
      // A connection that failed and a mail server that refused are different
      // problems, and the first one must not be described as the second.
      setErrors({
        form: err instanceof ApiError && (err.isNetwork || err.status === 0)
          ? errorLine(err)
          : emailSendMessage(err instanceof Error ? err.message : ''),
      });
    }
  };

  if (sentTo) {
    return (
      <AuthScaffold
        title="Check your inbox"
        lede={
          Platform.OS === 'web' ? (
            <>
              We sent a code and a link to <Txt variant="bodyStrong">{sentTo}</Txt>. Either one signs
              you in here — the code, or the button in the email.
            </>
          ) : (
            /*
             * On a phone the two are not interchangeable, and saying they were
             * was a promise the app could not keep: the link opens a browser and
             * signs in *there*, so the person came back to a phone that was
             * still signed out. The code is the way in on the device they are
             * holding; the link is what confirms the address if they would
             * rather do it in a browser first.
             */
            <>
              We sent a code to <Txt variant="bodyStrong">{sentTo}</Txt>. Type it below — that is
              what signs you in on this phone. The email also has a link, which confirms your
              address in a browser.
            </>
          )
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
            <Button title="Enter the code" icon="keypad-outline" onPress={() => setMode('code')} />
            <SendAnother
              busy={linkState === 'busy'}
              sent={linkState === 'done'}
              cooldown={cooldown}
              onPress={() => void sendAnother()}
            />
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
              <SendAnother
                busy={linkState === 'busy'}
                sent={linkState === 'done'}
                cooldown={cooldown}
                onPress={() => void sendAnother()}
              />
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
        onPress={() => setAgeEligible((a) => !a)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ageEligible }}
        accessibilityLabel="I’m 16 or older and agree to the Terms and Community Guidelines"
        style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: rhythm.group, paddingVertical: 4 }}
      >
        <View
          style={{
            width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: ageEligible ? colors.gold : colors.borderStrong,
            backgroundColor: ageEligible ? colors.gold : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1,
          }}
        >
          {ageEligible ? <Ionicons name="checkmark" size={16} color={colors.onGold} /> : null}
        </View>
        <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
          I’m 16 or older and I agree to the Terms and Community Guidelines.
        </Txt>
      </Pressable>
      {errors.ageEligible ? (
        <Txt variant="small" color="danger" style={{ marginTop: 6 }}>
          {errors.ageEligible}
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
      setError(errorLine(e));
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
      setError(errorLine(e));
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
      setError(errorLine(e));
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
