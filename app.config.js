const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

// Google installed-app OAuth clients redirect only to their own reversed client
// id, so that scheme has to be registered natively alongside the app's own.
function reversedClientIdScheme() {
  if (!clientId.endsWith('.apps.googleusercontent.com')) return null;
  return `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
}

module.exports = ({ config }) => {
  const oauthScheme = reversedClientIdScheme();
  if (!oauthScheme) return config;

  const schemes = Array.isArray(config.scheme)
    ? config.scheme
    : config.scheme
      ? [config.scheme]
      : [];

  return { ...config, scheme: [...schemes, oauthScheme] };
};
