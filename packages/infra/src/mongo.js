// db.js
import { MongoClient, ServerApiVersion, ClientEncryption, Binary, MongoServerError } from 'mongodb';
import { getMongoCredentials } from '#infra/aws-credentials'
import { ObjectId } from 'mongodb';
import log4js from 'log4js';
const logger = log4js.getLogger('mongo');

let client;
let clientPromise;
let lastConnectionTime;
let credentialExpiresAt;

const maxCredentialAge = 45 * 60 * 1000;
const credentialRefreshBuffer = 10 * 60 * 1000;

export function isMongoObjectId(v) {
  return ObjectId.isValid(v) && String(new ObjectId(v)) === String(v);
}

export async function findOrCreateDataKey(keyName, encryptionContext) {
    client = await getClient('findOrCreateDataKey');
    const dataKey = await client.db(process.env.databasename).collection("__keyVault").findOne({keyAltNames: { $in: [keyName]}});
    if (dataKey === null) {
        const keyId = await encryptionContext.createDataKey('local', {
            keyAltNames: [keyName]
        });
        return keyId.toString("base64");
    }
    return dataKey["_id"].toString('base64');
}

export async function getEncryptionContext() {
    client = await getClient('getEncryptionContext');

    const encryptionContext = new ClientEncryption(client, {
        provider: "local",
        keyVaultNamespace: `${process.env.databasename}.__keyVault`,
        kmsProviders: {
          local: {
            key: Buffer.from(process.env.LOCAL_MASTER_KEY, 'base64') // 96 bytes
          }
        }
    });

    return encryptionContext;
}

async function getMongoDBUri() {
    let uri = "";
    let expiresAt = null;

    if (process.env.mdbauth == "scram") {
        uri = `mongodb+srv://${process.env.mdbusername}:${process.env.mdbpassword}@${process.env.mdbhost}`;
    } else {
        const credentials = await getMongoCredentials();
        const aws_access_key = credentials.accessKeyId
        const aws_secret_key = encodeURIComponent(credentials.secretAccessKey)
        const aws_session_token = encodeURIComponent(credentials.sessionToken)

        logger.trace({
            description: "mongodb aws credentials resolved",
            accessKeyIdLast4: credentials.accessKeyId?.slice(-4),
            hasSessionToken: !!credentials.sessionToken,
            expiresAt: credentials.expiration?.toISOString?.() ?? null
        });
        expiresAt = credentials.expiration ? new Date(credentials.expiration) : null

        const url_params = "?authSource=%24external&authMechanism=MONGODB-AWS&retryWrites=true&w=majority&authMechanismProperties=AWS_SESSION_TOKEN:" + aws_session_token
        uri = "mongodb+srv://"+aws_access_key+":"+aws_secret_key+"@"+process.env.mdbhost+"/"+ url_params;
        logger.trace({'description':'mongodb uri', 'detail': uri})
    }

    return {uri, expiresAt};
}

export async function getClient(context = 'no context', silent = false) {
    if (!silent) logger.trace({ message: 'getting mongo client', context });

    const now = Date.now();
    const clientTooOld = lastConnectionTime && now - lastConnectionTime > maxCredentialAge;
    const credentialsExpiringSoon = credentialExpiresAt && now >= credentialExpiresAt.getTime() - credentialRefreshBuffer;
    const needsFreshClient = !client || clientTooOld || credentialsExpiringSoon;
    if (!needsFreshClient) return client;

    // Prevent multiple simultaneous requests from refreshing/closing/recreating.
    if (clientPromise) return await clientPromise;

    clientPromise = (async () => {
        const oldClient = client;

        if (!silent) {
            logger.debug({
                message: `creating fresh mongo client using auth type ${process.env.mdbauth}`,
                context,
                clientTooOld,
                credentialsExpiringSoon,
                credentialExpiresAt: credentialExpiresAt?.toISOString?.() ?? null
            });
        }

        const { uri, expiresAt } = await getMongoDBUri();

        const nextClient = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: false,
                deprecationErrors: true,
            }
        });

        await nextClient.connect();

        client = nextClient;
        lastConnectionTime = Date.now();
        credentialExpiresAt = expiresAt;

        if (oldClient) {
            oldClient.close().catch(err => {
                logger.warn({
                    message: "failed closing old mongo client",
                    error: err.message
                });
            });
        }

        return client;
    })();

    try {
        return await clientPromise;
    } finally {
        clientPromise = null;
    }
}

export function isDupKey(err) {
    // insert/update/bulk all end up with 11000 for unique violations
    if (!err) return false;
    if (err instanceof MongoServerError && err.code === 11000) return true;
    // bulkWrite aggregates errors
    if (Array.isArray(err?.writeErrors)) {
        return err.writeErrors.some(e => e?.code === 11000);
    }
    return err?.code === 11000;
}
  
export function parseDupKey(err) {
    // Best-effort extraction of index + offending key/value
    const index = err?.keyPattern ? Object.keys(err.keyPattern).join("_")
                 : err?.index ?? err?.errmsg?.match(/index:\s*([^\s]+)/)?.[1];
  
    const keyValue = err?.keyValue
                  ?? err?.errInfo?.details?.keyValue
                  ?? (() => {
                       const m = String(err?.errmsg || err?.message || "")
                         .match(/dup key.*\{(.*)\}/i);
                       return m ? ("{" + m[1] + "}") : null;
                     })();
  
    return { index, keyValue };
}

function isRetryableMongoTransactionError(err) {
    return (
        err?.errorLabels?.includes?.("TransientTransactionError") ||
        err?.errorLabels?.includes?.("UnknownTransactionCommitResult") ||
        err?.code === 112 ||
        err?.codeName === "WriteConflict" ||
        err?.message?.includes("Write conflict")
    );
}

export async function withTransactionRetry(client, fn, maxRetries = 5) {
    let lastErr;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const session = client.startSession();

        try {
            let result;

            await session.withTransaction(async () => {
                result = await fn(session);
            });

            return result;
        } catch (err) {
            lastErr = err;

            if (!isRetryableMongoTransactionError(err) || attempt === maxRetries) {
                throw err;
            }

            const delayMs = 50 * attempt + Math.floor(Math.random() * 50);

            logger.warn({
                message: "transaction failed with retryable error, retrying",
                attempt,
                delayMs,
                error: err.message,
                code: err.code,
                codeName: err.codeName,
                labels: [...(err.errorLabels || [])]
            });

            await new Promise(resolve => setTimeout(resolve, delayMs));
        } finally {
            await session.endSession();
        }
    }

    throw lastErr;
}

function isMongoAwsSts403(err) {
    return (
        err?.code === 8000 &&
        String(err?.message || err?.errmsg || "").includes("aws sts call has response 403")
    );
}

export async function resetMongoClient(reason = "reset") {
    logger.warn({ message: "resetting mongo client", reason });

    const oldClient = client;

    client = null;
    clientPromise = null;
    lastConnectionTime = null;
    credentialExpiresAt = null;

    if (oldClient) {
        await oldClient.close().catch(() => {});
    }
}

export async function withMongoAuthRetry(context, fn) {
    try {
        const mongo = await getClient(context);
        return await fn(mongo);
    } catch (err) {
        if (!isMongoAwsSts403(err)) {
            throw err;
        }

        logger.warn({
            message: "MongoDB AWS auth failed with STS 403; refreshing client and retrying once",
            context,
            error: err.message
        });

        await resetMongoClient("mongodb aws sts 403");

        const mongo = await getClient(`${context}:retry`);
        return await fn(mongo);
    }
}

// TODO: can wrap calls with auth retry
// const profile = await withMongoAuthRetry("GET /account", async mongo => {
//     return await mongo
//         .db(process.env.databasename)
//         .collection("profile")
//         .findOne({ _id: profileId });
// });