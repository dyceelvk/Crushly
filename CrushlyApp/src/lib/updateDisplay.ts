/** Status for Settings: a failed check is not proof that the app is current. */
export function androidUpdateStatus({ loading, error, hasData, available }: {
  loading: boolean;
  error: boolean;
  hasData: boolean;
  available: boolean;
}): 'checking' | 'error' | 'available' | 'current' {
  if (error) return 'error';
  if (!hasData) return loading ? 'checking' : 'error';
  return available ? 'available' : 'current';
}
