// aws-credentials.js
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { fromIni, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import log4js from 'log4js';
const logger = log4js.getLogger('aws-credentials');

let credentialsProvider = defaultProvider();

export async function getMongoCredentials() {
  const creds = await credentialsProvider();

  logger.trace('Resolved Mongo AWS credentials', {
    accessKeyIdLast4: creds.accessKeyId?.slice(-4),
    hasSessionToken: !!creds.sessionToken,
    expiration: creds.expiration?.toISOString?.() ?? null,
  });

  return creds;
}

/** Default: your app/account creds via env/SSO/role/profile chain */
export function getManagedCredentialsProvider() {
  return defaultProvider(); // returns () => Promise<Credentials>
}

/** Wrap user-supplied static keys as a provider */
export function makeStaticCredentialsProvider({ accessKeyId, secretAccessKey, sessionToken }) {
  const staticCreds = { accessKeyId, secretAccessKey, sessionToken };
  return async () => staticCreds;
}

/** Use a named profile (e.g., ~/.aws/credentials) */
export function makeProfileCredentialsProvider(profile) {
  return fromIni({ profile });
}

/** Assume role (best for BYOA via external ID) */
export function makeAssumeRoleProvider({ roleArn, externalId, sessionName = 'app-session', sourceProvider }) {
  return fromTemporaryCredentials({
    masterCredentials: sourceProvider ?? defaultProvider(),
    params: { RoleArn: roleArn, ExternalId: externalId, RoleSessionName: sessionName }
  });
}

/** optional: generic wrapper to add logging */
function withLogging(providerFn, name = 'unknown') {
  return async () => {
    logger.debug(`Resolving AWS credentials via provider "${name}"`);
    try {
      const creds = await providerFn();
      logger.trace(`Resolved AWS credentials via "${name}"`, {
        accessKeyIdLast4: creds.accessKeyId?.slice(-4),
        hasSessionToken: !!creds.sessionToken,
        expiration: creds.expiration?.toISOString?.() ?? null,
      });
      return creds;
    } catch (err) {
      logger.error(`Failed to resolve AWS credentials via "${name}"`, {
        message: err.message,
        name: err.name,
      });
      throw err;
    }
  };
}

/* Registry */
const registry = new Map();
registry.set('managed', getManagedCredentialsProvider());

export function registerCredentialsProvider(key, providerFn) {
  if (typeof providerFn !== 'function') {
    logger.error('Attempted to register credentials provider that is not a function', {
      key,
      type: typeof providerFn,
      // try to give a short preview for debugging
      valuePreview: (() => {
        try {
          return JSON.stringify(providerFn, null, 200).slice(0, 200);
        } catch {
          return String(providerFn);
        }
      })(),
    });
    throw new Error(`Provider for "${key}" must be a function`);
  }
  registry.set(key, providerFn);
}

export function getCredentialsProvider(key = 'managed', { withLogs = true } = {}) {
  logger.trace({'description': 'get aws cred provider', 'detail': key})
  const base = registry.get(key);
  if (!base) return null;
  return withLogs ? withLogging(base, key) : base;
}