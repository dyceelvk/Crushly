/** Release switch: keep Plus and its signup implementation in the codebase,
 * but do not expose it until the product owner explicitly enables it. */
export const PLUS_VISIBLE = false;

/** Existing incognito users must always retain a way to switch it off. */
export function showIncognitoControl(plusVisible: boolean, currentlyEnabled: boolean): boolean {
  return plusVisible || currentlyEnabled;
}
