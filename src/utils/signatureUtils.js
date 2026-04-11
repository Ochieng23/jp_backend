import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
import logger from './logger.js';

/**
 * Generate a new Ed25519 key pair for an organisation.
 * The returned privateKeyMultibase should be stored securely as an environment variable.
 *
 * @param {string} orgName - Human-readable organisation name (used in key ID)
 * @returns {Promise<{ did: string, publicKeyJwk: object, privateKeyMultibase: string }>}
 */
export async function generateKeyPair(orgName) {
  const keyPair = await Ed25519VerificationKey2020.generate();

  // Build a simple did:key DID from the public key
  const did = `did:key:${keyPair.publicKeyMultibase}`;

  // Export public key as JWK for storage in the DB
  const publicKeyJwk = await keyPair.export({ publicKey: true, privateKey: false });

  // Export private key as multibase string for env-var storage
  const privateExport = await keyPair.export({ publicKey: false, privateKey: true });
  const privateKeyMultibase = privateExport.privateKeyMultibase;

  logger.debug(`Generated key pair for org: ${orgName}, DID: ${did}`);

  return {
    did,
    publicKeyJwk,
    privateKeyMultibase,
  };
}

/**
 * Sign arbitrary data with an organisation's Ed25519 private key.
 * The private key is read from the environment variable ORG_PRIVATE_KEY_{orgId}.
 * The value should be the multibase-encoded private key bytes (starts with 'z').
 *
 * @param {string} orgId - UUID of the organisation
 * @param {Uint8Array} data - Raw bytes to sign
 * @returns {Promise<string>} Base64url-encoded signature
 */
export async function signData(orgId, data) {
  const envKey = `ORG_PRIVATE_KEY_${orgId}`;
  const privateKeyMultibase = process.env[envKey];

  if (!privateKeyMultibase) {
    throw new Error(`Private key not found in environment for org ${orgId} (expected env var: ${envKey})`);
  }

  // Reconstruct the key pair from the stored private key
  const keyPair = await Ed25519VerificationKey2020.from({
    privateKeyMultibase,
  });

  const signer = keyPair.signer();
  const signature = await signer.sign({ data });

  // Convert Uint8Array signature to base64url
  const base64url = Buffer.from(signature).toString('base64url');
  return base64url;
}

/**
 * Verify a base64url-encoded Ed25519 signature against a public key JWK.
 *
 * @param {object} publicKeyJwk - JWK representation of the Ed25519 public key
 * @param {Uint8Array} data - The original signed data
 * @param {string} signatureBase64url - Base64url-encoded signature to verify
 * @returns {Promise<boolean>} true if the signature is valid
 */
export async function verifySignature(publicKeyJwk, data, signatureBase64url) {
  try {
    // Reconstruct key pair from JWK export (which contains publicKeyMultibase)
    const keyPair = await Ed25519VerificationKey2020.from(publicKeyJwk);

    const verifier = keyPair.verifier();
    const signatureBytes = Buffer.from(signatureBase64url, 'base64url');

    const valid = await verifier.verify({ data, signature: signatureBytes });
    return valid;
  } catch (err) {
    logger.warn(`Signature verification error: ${err.message}`);
    return false;
  }
}
