import React, { useEffect, useState } from 'react';
import { Input } from './Input';
import { usernameAvailable } from '../api/service';

/**
 * The @handle picker. Handles are lowercase letters, numbers and underscores,
 * so anything else is dropped as it's typed rather than rejected afterwards —
 * on a phone keyboard that is the difference between a usable field and a
 * frustrating one.
 *
 * Availability is a hint for the person typing, not a decision: the database
 * makes the final call when they save, because two people can type the same
 * handle in the same second.
 */
export function UsernameField({
  value,
  onChange,
  error,
  label = 'Username',
  hint,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  label?: string;
  hint?: string;
  onSubmit?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState(false);
  const valid = /^[a-z0-9_]{3,20}$/.test(value) && /[a-z]/.test(value);

  useEffect(() => {
    if (!valid) {
      setTaken(false);
      setChecking(false);
      return;
    }
    let alive = true;
    setChecking(true);
    const timer = setTimeout(() => {
      void usernameAvailable(value)
        .then((free) => {
          if (alive) setTaken(!free);
        })
        .catch(() => undefined) // offline: let the save decide
        .finally(() => {
          if (alive) setChecking(false);
        });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [value, valid]);

  const message = error
    ? error
    : checking
      ? 'Checking…'
      : taken
        ? 'That username is taken. Try another.'
        : value.length && !valid
          ? '3–20 characters: letters, numbers and underscores, with at least one letter.'
          : hint || 'This is how people find you. You can change it once a day.';

  return (
    <Input
      label={label}
      value={value}
      onChangeText={(t) => onChange(t.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
      placeholder="yourname"
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      autoComplete="username"
      textContentType="username"
      maxLength={20}
      icon="at-outline"
      error={error || (taken ? ' ' : null)}
      hint={message}
      onSubmitEditing={onSubmit}
      returnKeyType="done"
      accessibilityLabel={`${label}, at handle`}
    />
  );
}
