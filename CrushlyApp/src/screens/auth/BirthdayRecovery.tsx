import React, { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { useAuth } from '../../state/auth';
import { updateProfile } from '../../api/service';
import { keys } from '../../api/hooks';
import { useToast } from '../../components/Toast';
import { ageFromBirthdate } from '../../lib/format';
import { space } from '../../theme/tokens';

/** Recovery for existing profiles with a missing/invalid birthday. It is not
 * an age-verification mechanism or a substitute for server authorization. */
export function BirthdayRecoveryScreen() {
  const { me, signOut } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const initial = /^\d{4}-\d{2}-\d{2}$/.test(me?.profile.birthdate ?? '') ? me!.profile.birthdate!.split('-') : ['', '', ''];
  const [year, setYear] = useState(initial[0]);
  const [month, setMonth] = useState(initial[1]);
  const [day, setDay] = useState(initial[2]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    const birthday = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const age = ageFromBirthdate(birthday);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || age == null || age > 99 || age < 0) {
      setError('Enter a valid birthday.'); return;
    }
    if (age < 18) { setError('Holup currently requires you to be 18 or older.'); return; }
    setError(''); setBusy(true);
    try {
      const updated = await updateProfile({ birthdate: birthday });
      qc.setQueryData(keys.me, updated);
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t finish', message: (e as Error).message });
    } finally { setBusy(false); }
  };
  return <Screen keyboard><Header title="Confirm your birthday" subtitle="Your account needs a valid birthday before you can continue." />
    <View style={{ gap: space.lg }}>
      <Txt variant="body" color="textSecondary">Enter your real date of birth. It won’t be shown directly on your Space.</Txt>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Input label="Day" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} containerStyle={{ flex: 1 }} />
        <Input label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} containerStyle={{ flex: 1 }} />
        <Input label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} containerStyle={{ flex: 1.4 }} />
      </View>
      {error ? <Txt color="danger" accessibilityLiveRegion="polite">{error}</Txt> : null}
      <Button title="Continue" onPress={() => void save()} loading={busy} disabled={busy} />
      <Button title="Sign out" variant="ghost" disabled={busy} onPress={() => void signOut()} />
      <Txt variant="small" color="textSecondary">Need help? Contact rielosInc@gmail.com.</Txt>
    </View>
  </Screen>;
}
