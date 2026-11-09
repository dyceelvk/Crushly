import { createIsolatedTeenClient } from './isolatedClient';

/** Only a declared cohort is known. This is not proof of age or a badge. */
export type TeenAccountState = {
  enrolled: boolean;
  active: boolean;
  consentStatus?: 'pending' | 'granted' | 'withdrawn';
  accountStatus?: 'active' | 'suspended' | 'closed';
  birthday?: string;
  ageSelfReported?: boolean;
};
export type TeenProfile = { id: string; name: string; handle: string };
export type TeenIncomingKeep = { id: string; name: string; mutual: boolean };
export type TeenReportReason = 'harassment' | 'sexual_content' | 'impersonation' | 'adult_impostor' | 'threat' | 'other';

/**
 * Unwired tenant-specific API facade. It can only construct a new teen client;
 * it cannot be handed the adult client or an adult session. Authentication,
 * guardian consent, moderation and the teen UI are not yet integrated. Never
 * use this as evidence that the service is safe or ready for children.
 */
export function createTeenService(config: { adultProjectUrl: string; teenProjectUrl: string; teenPublishableKey: string }) {
  const client = createIsolatedTeenClient(config);
  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message || 'That action is unavailable.');
    return data as T;
  }
  return {
    /** This client has its own session; it never reads the adult session. */
    auth: client.auth,
    myState: () => rpc<TeenAccountState>('teen_my_state'),
    declareBirthday: (birthday: string) => rpc<{ consentRequired: boolean; active: boolean }>('teen_declare_birthdate', { p_birthdate: birthday }),
    setProfile: (name: string, handle: string, discoverable: boolean) => rpc<boolean>('teen_set_profile', { p_name: name, p_handle: handle, p_discoverable: discoverable }),
    findProfile: (handle: string) => rpc<TeenProfile | null>('teen_find_profile', { p_handle: handle }),
    keep: (target: string) => rpc<{ keeps: boolean; mutual: boolean }>('teen_keep', { p_target: target }),
    unkeep: (target: string) => rpc<boolean>('teen_unkeep', { p_target: target }),
    block: (target: string) => rpc<boolean>('teen_block', { p_target: target }),
    closeOnes: () => rpc<{ items: TeenProfile[] }>('teen_close_ones'),
    incomingKeeps: () => rpc<{ items: TeenIncomingKeep[] }>('teen_kept_you_close'),
    report: (target: string, reason: TeenReportReason, details: string, block = true) =>
      rpc<{ received: boolean; reportId: number; blocked: boolean }>('teen_report_member', { p_target: target, p_reason: reason, p_details: details, p_also_block: block }),
  };
}
