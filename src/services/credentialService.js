import { v4 as uuidv4 } from 'uuid';
import * as credentialRepository from '../repositories/credentialRepository.js';
import * as holderRepository from '../repositories/holderRepository.js';
import * as organizationRepository from '../repositories/organizationRepository.js';
import * as auditRepository from '../repositories/auditRepository.js';
import * as recognitionRepository from '../repositories/recognitionRepository.js';
import * as recognitionService from './recognitionService.js';
import { buildVCDocument, issueVC, verifyVC } from '../utils/vcUtils.js';
import logger from '../utils/logger.js';

/**
 * Holder self-reports a credential.
 * Builds a minimal VC document, signs it with a platform key (if available),
 * stores the credential in the database, and logs an audit event.
 *
 * @param {string} holderId - UUID of the holder
 * @param {object} data
 * @param {string} data.type - Credential type string
 * @param {string} data.title - Human-readable title
 * @param {string} [data.description]
 * @param {string} data.issued_at - ISO timestamp
 * @param {string} [data.expires_at]
 * @param {string} [data.jurisdiction_id]
 * @param {string} data.issuer_id - UUID of the issuing organisation (self-reported placeholder)
 * @returns {Promise<object>} Created credential row
 */
export async function selfReportCredential(holderId, data) {
  const holder = await holderRepository.findHolderById(holderId);
  if (!holder) {
    const err = new Error('Holder not found');
    err.statusCode = 404;
    throw err;
  }

  const org = await organizationRepository.findById(data.issuer_id);
  if (!org) {
    const err = new Error('Issuing organisation not found');
    err.statusCode = 404;
    throw err;
  }

  const credentialId = uuidv4();
  const holderDid = `did:passport:holder:${holderId}`;
  const issuerDid = org.did;

  const unsignedVC = buildVCDocument({
    issuerDid,
    holderDid,
    credentialType: data.type,
    credentialSubject: {
      title: data.title,
      description: data.description || '',
      selfReported: true,
    },
    issuanceDate: data.issued_at,
    expirationDate: data.expires_at || undefined,
  });

  // For self-reported credentials we store the unsigned VC and an empty proof value.
  // The credential can be signed later if the issuer endorses it.
  let signedVC = unsignedVC;
  let proofValue = 'self-reported';

  // Attempt to sign with the org's key if available in env
  const envKey = `ORG_PRIVATE_KEY_${data.issuer_id}`;
  if (process.env[envKey]) {
    try {
      const verificationMethodId = `${issuerDid}#${issuerDid.split(':').pop()}`;
      signedVC = await issueVC(unsignedVC, data.issuer_id, verificationMethodId);
      proofValue = signedVC.proof?.proofValue || 'signed';
    } catch (err) {
      logger.warn(`Self-report signing skipped (no key or key error): ${err.message}`);
    }
  }

  const credential = await credentialRepository.createCredential({
    id: credentialId,
    holder_id: holderId,
    issuer_id: data.issuer_id,
    type: data.type,
    title: data.title,
    description: data.description || null,
    issued_at: data.issued_at,
    expires_at: data.expires_at || null,
    status: 'active',
    vc_json: signedVC,
    proof_value: proofValue,
    jurisdiction_id: data.jurisdiction_id || null,
    document_url: data.document_url || null,
    document_key: data.document_key || null,
  });

  // Audit log — resource_id must be the credential's real Mongo _id.
  // `credentialId` (a UUID) was never actually persisted: the Credential
  // schema has no `id` field, so Mongoose silently drops it in strict mode
  // and assigns its own ObjectId `_id` instead. Passing the UUID here used
  // to crash this whole request (AuditLog.resource_id is ObjectId-typed).
  await auditRepository.logAction({
    id: uuidv4(),
    actor_id: holderId,
    actor_type: 'holder',
    action: 'credential.self_reported',
    resource_type: 'credential',
    resource_id: credential._id,
    metadata: { type: data.type, title: data.title },
    jurisdiction_id: data.jurisdiction_id || null,
  });

  logger.info(`Credential self-reported: ${credential._id} by holder ${holderId}`);
  return credential;
}

/**
 * Issue a Verifiable Credential from an organisation to a holder.
 * Signs with the org's ed25519 key, persists to the database, enqueues
 * recognition-evaluation jobs for all relevant jurisdictions, and logs an audit event.
 *
 * @param {string} orgId - UUID of the issuing organisation
 * @param {string} holderId - UUID of the credential recipient
 * @param {object} data
 * @param {string} data.type - Credential type
 * @param {string} data.title
 * @param {string} [data.description]
 * @param {object} data.credential_subject - Additional credential subject claims
 * @param {string} [data.expires_at] - ISO timestamp
 * @param {string} [data.jurisdiction_id]
 * @returns {Promise<object>} Created credential row
 */
export async function issueCredential(orgId, holderId, data) {
  const [org, holder] = await Promise.all([
    organizationRepository.findById(orgId),
    holderRepository.findHolderById(holderId),
  ]);

  if (!org) {
    const err = new Error('Organisation not found');
    err.statusCode = 404;
    throw err;
  }
  if (!org.verified) {
    const err = new Error('Organisation is not verified and cannot issue credentials');
    err.statusCode = 403;
    throw err;
  }
  if (!holder) {
    const err = new Error('Holder not found');
    err.statusCode = 404;
    throw err;
  }

  const credentialId = uuidv4();
  const holderDid = `did:passport:holder:${holderId}`;
  const issuerDid = org.did;
  const issuanceDate = new Date().toISOString();
  const verificationMethodId = `${issuerDid}#${issuerDid.split(':').pop()}`;

  const unsignedVC = buildVCDocument({
    issuerDid,
    holderDid,
    credentialType: data.type,
    credentialSubject: {
      title: data.title,
      description: data.description || '',
      ...data.credential_subject,
    },
    issuanceDate,
    expirationDate: data.expires_at || undefined,
  });

  const signedVC = await issueVC(unsignedVC, orgId, verificationMethodId);
  const proofValue = signedVC.proof?.proofValue || 'issued';

  const credential = await credentialRepository.createCredential({
    id: credentialId,
    holder_id: holderId,
    issuer_id: orgId,
    type: data.type,
    title: data.title,
    description: data.description || null,
    issued_at: issuanceDate,
    expires_at: data.expires_at || null,
    status: 'active',
    vc_json: signedVC,
    proof_value: proofValue,
    jurisdiction_id: data.jurisdiction_id || org.jurisdiction_id || null,
  });

  // Audit log — resource_id must be the credential's real Mongo _id, not the
  // unpersisted UUID (see the note in selfReportCredential above).
  await auditRepository.logAction({
    id: uuidv4(),
    actor_id: orgId,
    actor_type: 'organization',
    action: 'credential.issued',
    resource_type: 'credential',
    resource_id: credential._id,
    metadata: { holder_id: holderId, type: data.type, title: data.title },
    jurisdiction_id: credential.jurisdiction_id,
  });

  // Evaluate recognition synchronously (no background queue in this MVP) for every
  // jurisdiction the holder already has credentials or recognitions in.
  const { rows: holderCredentials } = await credentialRepository.findCredentialsByHolder(holderId, {
    limit: 1000,
    offset: 0,
  });
  const existingRecognitions = await recognitionRepository.findByHolder(holderId);

  const jurisdictionIds = new Set();
  for (const c of holderCredentials) {
    const jid = c.jurisdiction_id?._id || c.jurisdiction_id;
    if (jid) jurisdictionIds.add(String(jid));
  }
  for (const r of existingRecognitions) {
    const jid = r.target_jurisdiction_id?._id || r.target_jurisdiction_id;
    if (jid) jurisdictionIds.add(String(jid));
  }

  for (const jurisdictionId of jurisdictionIds) {
    try {
      await recognitionService.evaluateRecognition(credential.id, jurisdictionId);
    } catch (err) {
      logger.warn(
        `Auto-evaluation failed for credential ${credential.id} in jurisdiction ${jurisdictionId}: ${err.message}`
      );
    }
  }

  logger.info(`Credential issued: ${credential.id} by org ${orgId} to holder ${holderId}`);
  return credential;
}

/**
 * Revoke a credential. Only the issuing organisation admin or a platform admin
 * may revoke. Updates status to 'revoked' and logs an audit event.
 *
 * @param {string} credentialId - UUID of the credential to revoke
 * @param {string} actorId - UUID of the actor performing the revocation
 * @param {string} actorRole - 'holder' | 'org_admin' | 'platform_admin'
 * @returns {Promise<object>} Updated credential row
 */
export async function revokeCredential(credentialId, actorId, actorRole) {
  const credential = await credentialRepository.findCredentialById(credentialId);
  if (!credential) {
    const err = new Error('Credential not found');
    err.statusCode = 404;
    throw err;
  }

  if (credential.status === 'revoked') {
    const err = new Error('Credential is already revoked');
    err.statusCode = 409;
    throw err;
  }

  // Authorisation check
  const isIssuer = actorRole === 'org_admin' && String(credential.issuer_id) === String(actorId);
  const isPlatformAdmin = actorRole === 'platform_admin';

  if (!isIssuer && !isPlatformAdmin) {
    const err = new Error('Only the issuing organisation or a platform admin may revoke this credential');
    err.statusCode = 403;
    throw err;
  }

  const updated = await credentialRepository.updateCredentialStatus(credentialId, 'revoked');

  await auditRepository.logAction({
    id: uuidv4(),
    actor_id: actorId,
    actor_type: actorRole === 'platform_admin' ? 'admin' : 'organization',
    action: 'credential.revoked',
    resource_type: 'credential',
    resource_id: credentialId,
    metadata: { previous_status: credential.status, revoked_by: actorId },
    jurisdiction_id: credential.jurisdiction_id,
  });

  logger.info(`Credential revoked: ${credentialId} by actor ${actorId}`);
  return updated;
}

/**
 * Cryptographically verify a Verifiable Credential by its database ID.
 * Checks the proof, expiry, and revocation status.
 *
 * @param {string} credentialId - UUID of the credential
 * @returns {Promise<{ valid: boolean, issuer: object, holder: object, checks: string[] }>}
 */
export async function verifyCredential(credentialId) {
  const credentialWithIssuer = await credentialRepository.getCredentialWithIssuer(credentialId);

  if (!credentialWithIssuer) {
    const err = new Error('Credential not found');
    err.statusCode = 404;
    throw err;
  }

  const checks = [];

  // Check revocation status
  if (credentialWithIssuer.status === 'revoked') {
    return {
      valid: false,
      issuer: credentialWithIssuer.issuer,
      holder: { id: credentialWithIssuer.holder_id },
      checks: ['status'],
      reason: 'Credential has been revoked',
    };
  }
  checks.push('status');

  // Check expiry
  if (credentialWithIssuer.expires_at) {
    if (new Date(credentialWithIssuer.expires_at) < new Date()) {
      return {
        valid: false,
        issuer: credentialWithIssuer.issuer,
        holder: { id: credentialWithIssuer.holder_id },
        checks,
        reason: 'Credential has expired',
      };
    }
  }
  checks.push('expiry');

  // Cryptographic proof verification
  const vcDocument =
    typeof credentialWithIssuer.vc_json === 'string'
      ? JSON.parse(credentialWithIssuer.vc_json)
      : credentialWithIssuer.vc_json;

  let cryptoResult = { verified: true, checks: ['proof'] };

  // Only run crypto verification if the credential has a real proof
  if (vcDocument.proof && credentialWithIssuer.proof_value !== 'self-reported') {
    try {
      const publicKeyJwk =
        typeof credentialWithIssuer.issuer?.public_key_jwk === 'string'
          ? JSON.parse(credentialWithIssuer.issuer.public_key_jwk)
          : credentialWithIssuer.issuer?.public_key_jwk;
      cryptoResult = await verifyVC(vcDocument, publicKeyJwk);
    } catch (err) {
      logger.warn(`Crypto verification error for credential ${credentialId}: ${err.message}`);
      cryptoResult = { verified: false, checks: [], error: err.message };
    }
  } else {
    checks.push('proof_skipped_self_reported');
  }

  const allChecks = [...checks, ...cryptoResult.checks];

  return {
    valid: cryptoResult.verified,
    issuer: credentialWithIssuer.issuer,
    holder: { id: credentialWithIssuer.holder_id },
    checks: allChecks,
    ...(cryptoResult.error && { reason: cryptoResult.error }),
  };
}
