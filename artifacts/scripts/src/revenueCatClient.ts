import { createClient } from '@replit/revenuecat-sdk/client';

let connectionSettings: any;

async function getApiKeyFromConnector(): Promise<string | null> {
  try {
    if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
      return connectionSettings.settings.access_token;
    }

    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? 'repl ' + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

    if (!xReplitToken || !hostname) return null;

    connectionSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=revenuecat',
      {
        headers: {
          'Accept': 'application/json',
          'X-Replit-Token': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data.items?.[0]);

    const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
    return accessToken || null;
  } catch {
    return null;
  }
}

async function getApiKey(): Promise<string> {
  const connectorKey = await getApiKeyFromConnector();
  if (connectorKey) return connectorKey;

  const envKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (envKey) {
    console.log("Using REVENUECAT_SECRET_API_KEY from environment");
    return envKey;
  }

  throw new Error(
    'RevenueCat not connected. Either fix the connector or set REVENUECAT_SECRET_API_KEY environment variable.\n' +
    'Find your v2 secret key in RevenueCat dashboard: Project Settings > API Keys.'
  );
}

export async function getUncachableRevenueCatClient() {
  const apiKey = await getApiKey();
  return createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    headers: { Authorization: "Bearer " + apiKey },
  });
}
