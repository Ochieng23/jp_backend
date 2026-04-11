import * as vc from '@digitalbazaar/vc';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
// @digitalbazaar/security-context is a CJS module — use default import
// securityLoader may not exist; fall back to vc.defaultDocumentLoader only

import logger from './logger.js';

// ─── JSON-LD document loader ──────────────────────────────────────────────────
// Cache well-known contexts to avoid external HTTP calls in production
const documentLoader = vc.defaultDocumentLoader;

/**
 * Build an unsigned W3C Verifiable Credential JSON-LD document.
 *
 * @param {object} opts
 * @param {string} opts.issuerDid - DID URI of the issuing organisation
 * @param {string} opts.holderDid - DID URI of the credential holder
 * @param {string|string[]} opts.credentialType - Type string(s) beyond 'VerifiableCredential'
 * @param {object} opts.credentialSubject - The credential subject claims
 * @param {string} opts.issuanceDate - ISO 8601 date string
 * @param {string} [opts.expirationDate] - ISO 8601 date string (optional)
 * @returns {object} Unsigned VC JSON-LD document
 */
export function buildVCDocument(opts) {
  const { issuerDid, holderDid, credentialType, credentialSubject, issuanceDate, expirationDate } =
    opts;

  const types = ['VerifiableCredential'];
  if (Array.isArray(credentialType)) {
    types.push(...credentialType);
  } else if (credentialType) {
    types.push(credentialType);
  }

  const unsignedVC = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: `urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : generateUUID()}`,
    type: types,
    issuer: issuerDid,
    issuanceDate,
    credentialSubject: {
      id: holderDid,
      ...credentialSubject,
    },
  };

  if (expirationDate) {
    unsignedVC.expirationDate = expirationDate;
  }

  return unsignedVC;
}

/**
 * Fallback UUID v4 generator if crypto.randomUUID is unavailable.
 * @returns {string}
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Issue (sign) a Verifiable Credential using the organisation's Ed25519 private key.
 * The private key is read from env: ORG_PRIVATE_KEY_{orgId} (multibase encoded).
 *
 * @param {object} unsignedVC - Unsigned VC document from buildVCDocument()
 * @param {string} orgId - UUID of the issuing organisation (used to look up env key)
 * @param {string} verificationMethodId - Full DID fragment URL for the signing key
 *   e.g. 'did:key:z6Mk...#z6Mk...'
 * @returns {Promise<object>} Signed VC with a proof block
 * @throws {Error} If the org's private key is not set in the environment
 */
export async function issueVC(unsignedVC, orgId, verificationMethodId) {
  const envKey = `ORG_PRIVATE_KEY_${orgId}`;
  const privateKeyMultibase = process.env[envKey];

  if (!privateKeyMultibase) {
    throw new Error(
      `Cannot issue VC: private key not found for org ${orgId} (expected env var: ${envKey})`
    );
  }

  // Reconstruct the key pair
  const keyPair = await Ed25519VerificationKey2020.from({
    id: verificationMethodId,
    controller: unsignedVC.issuer,
    privateKeyMultibase,
  });

  const suite = new Ed25519Signature2020({ key: keyPair });

  try {
    const signedVC = await vc.issue({
      credential: structuredClone(unsignedVC),
      suite,
      documentLoader,
    });
    logger.debug(`VC issued: ${signedVC.id}`);
    return signedVC;
  } catch (err) {
    logger.error(`VC issuance failed: ${err.message}`);
    throw new Error(`Failed to issue VC: ${err.message}`);
  }
}

/**
 * Cryptographically verify a Verifiable Credential's proof.
 * Also checks the credential's expiry date if present.
 *
 * @param {object} signedVC - Signed VC document including the proof block
 * @param {object} publicKeyJwk - Public key JWK from the issuing_organization table
 * @returns {Promise<{ verified: boolean, checks: string[], error?: string }>}
 */
export async function verifyVC(signedVC, publicKeyJwk) {
  const checks = [];

  try {
    // Reconstruct the verification key from JWK / multibase export
    const keyPair = await Ed25519VerificationKey2020.from(publicKeyJwk);

    const suite = new Ed25519Signature2020({ key: keyPair });

    const result = await vc.verifyCredential({
      credential: signedVC,
      suite,
      documentLoader,
    });

    if (result.verified) {
      checks.push('proof');
    }

    // Check expiry
    if (signedVC.expirationDate) {
      const expiry = new Date(signedVC.expirationDate);
      if (expiry < new Date()) {
        return {
          verified: false,
          checks,
          error: 'Credential has expired',
        };
      }
      checks.push('expiry');
    } else {
      checks.push('expiry');
    }

    return {
      verified: result.verified,
      checks,
      error: result.error ? String(result.error) : undefined,
    };
  } catch (err) {
    logger.warn(`VC verification threw: ${err.message}`);
    return {
      verified: false,
      checks,
      error: err.message,
    };
  }
}
