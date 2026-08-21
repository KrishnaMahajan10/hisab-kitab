import {
  AuthRequest,
  ResponseType,
  exchangeCodeAsync,
  refreshAsync,
  revokeAsync,
  type AuthSessionResult,
} from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'hisab.google.refreshToken';

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

/**
 * Set by EXPO_PUBLIC_GOOGLE_CLIENT_ID (a Google Cloud OAuth client of type
 * Android/iOS). Public by design: installed-app clients have no secret and rely
 * on PKCE, so there is nothing here worth hiding.
 */
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export function isConfigured(): boolean {
  return GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com');
}

/**
 * Installed-app OAuth clients must redirect to their own reversed client id;
 * Google rejects any other custom scheme for this client type.
 */
function redirectUri(): string {
  const bare = GOOGLE_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, '');
  return `com.googleusercontent.apps.${bare}:/oauth2redirect`;
}

export class NotConnectedError extends Error {
  constructor() {
    super('Google Drive is not connected');
    this.name = 'NotConnectedError';
  }
}

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

export async function isConnected(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)) !== null;
}

/**
 * Opens the Google consent screen and stores the resulting refresh token.
 * Returns false when the user dismisses the browser rather than throwing, so a
 * cancelled sign-in is not reported to them as a failure.
 */
export async function connect(): Promise<boolean> {
  if (!isConfigured()) {
    throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID is not set');
  }

  const request = new AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri: redirectUri(),
    responseType: ResponseType.Code,
    scopes: [DRIVE_APPDATA_SCOPE],
    usePKCE: true,
    // Google only returns a refresh token for an offline request, and only
    // re-returns one when consent is asked for again.
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const result: AuthSessionResult = await request.promptAsync(DISCOVERY);
  if (result.type !== 'success') {
    if (result.type === 'error') {
      throw new Error(result.error?.message ?? 'Google sign-in failed');
    }
    return false;
  }

  const code = result.params.code;
  if (!code) throw new Error('Google returned no authorization code');

  const tokens = await exchangeCodeAsync(
    {
      clientId: GOOGLE_CLIENT_ID,
      code,
      redirectUri: redirectUri(),
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : {},
    },
    DISCOVERY
  );

  if (!tokens.refreshToken) {
    throw new Error('Google returned no refresh token — revoke app access and try again');
  }

  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  accessToken = tokens.accessToken;
  accessTokenExpiresAt = Date.now() + (tokens.expiresIn ?? 3600) * 1000;
  return true;
}

export async function getAccessToken(): Promise<string> {
  // 60s of slack so a token does not expire mid-upload.
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;

  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) throw new NotConnectedError();

  const tokens = await refreshAsync(
    { clientId: GOOGLE_CLIENT_ID, refreshToken, scopes: [DRIVE_APPDATA_SCOPE] },
    DISCOVERY
  );

  accessToken = tokens.accessToken;
  accessTokenExpiresAt = Date.now() + (tokens.expiresIn ?? 3600) * 1000;
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
  return accessToken;
}

export async function disconnect(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  accessToken = null;
  accessTokenExpiresAt = 0;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);

  if (refreshToken) {
    try {
      await revokeAsync({ clientId: GOOGLE_CLIENT_ID, token: refreshToken }, DISCOVERY);
    } catch {
      // Local credentials are already gone; the user can revoke from their
      // Google account page if the network call did not land.
    }
  }
}
