import { jest } from '@jest/globals';

// We test buildVCDocument directly (no external deps).
// For issueVC and verifyVC we mock the digitalbazaar libraries since they
// require a real key pair and network-accessible JSON-LD contexts.

// ─── Partial mocks for @digitalbazaar packages ────────────────────────────────

const mockSign = jest.fn();
const mockVerify = jest.fn();

const mockKeyPair = {
  id: 'did:key:zMockKey#zMockKey',
  controller: 'did:key:zMockKey',
  signer: () => ({ sign: mockSign }),
  verifier: () => ({ verify: mockVerify }),
  export: jest.fn().mockResolvedValue({ publicKeyMultibase: 'zMockPublicKey' }),
};

jest.unstable_mockModule('@digitalbazaar/ed25519-verification-key-2020', () => ({
  Ed25519VerificationKey2020: {
    generate: jest.fn().mockResolvedValue(mockKeyPair),
    from: jest.fn().mockResolvedValue(mockKeyPair),
  },
}));

const mockIssue = jest.fn();
const mockVerifyCredential = jest.fn();

jest.unstable_mockModule('@digitalbazaar/vc', () => ({
  default: {
    issue: mockIssue,
    verifyCredential: mockVerifyCredential,
    defaultDocumentLoader: jest.fn(),
  },
  issue: mockIssue,
  verifyCredential: mockVerifyCredential,
  defaultDocumentLoader: jest.fn(),
}));

jest.unstable_mockModule('@digitalbazaar/ed25519-signature-2020', () => ({
  Ed25519Signature2020: jest.fn().mockImplementation(() => ({})),
}));

// ─── Import under test ────────────────────────────────────────────────────────

const { buildVCDocument, issueVC, verifyVC } = await import('../utils/vcUtils.js');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('vcUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── buildVCDocument ─────────────────────────────────────────────────────────

  describe('buildVCDocument', () => {
    it('returns a valid JSON-LD structure with correct @context', () => {
      const doc = buildVCDocument({
        issuerDid: 'did:key:zIssuer',
        holderDid: 'did:key:zHolder',
        credentialType: 'NursingCertificate',
        credentialSubject: { title: 'Registered Nurse' },
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      expect(doc).toHaveProperty('@context');
      expect(doc['@context']).toContain('https://www.w3.org/2018/credentials/v1');
      expect(doc['@context']).toContain(
        'https://w3id.org/security/suites/ed25519-2020/v1'
      );
    });

    it('includes VerifiableCredential in the type array', () => {
      const doc = buildVCDocument({
        issuerDid: 'did:key:zIssuer',
        holderDid: 'did:key:zHolder',
        credentialType: 'WeldingCertificate',
        credentialSubject: {},
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      expect(doc.type).toContain('VerifiableCredential');
      expect(doc.type).toContain('WeldingCertificate');
    });

    it('sets credentialSubject.id to holderDid', () => {
      const holderDid = 'did:passport:holder:test-uuid';
      const doc = buildVCDocument({
        issuerDid: 'did:key:zIssuer',
        holderDid,
        credentialType: 'Certificate',
        credentialSubject: { foo: 'bar' },
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      expect(doc.credentialSubject.id).toBe(holderDid);
      expect(doc.credentialSubject.foo).toBe('bar');
    });

    it('sets issuer to issuerDid', () => {
      const issuerDid = 'did:key:zIssuerOrg';
      const doc = buildVCDocument({
        issuerDid,
        holderDid: 'did:key:zHolder',
        credentialType: 'Cert',
        credentialSubject: {},
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      expect(doc.issuer).toBe(issuerDid);
    });

    it('includes expirationDate when provided', () => {
      const doc = buildVCDocument({
        issuerDid: 'did:key:zIssuer',
        holderDid: 'did:key:zHolder',
        credentialType: 'Cert',
        credentialSubject: {},
        issuanceDate: '2024-01-15T00:00:00.000Z',
        expirationDate: '2029-01-15T00:00:00.000Z',
      });

      expect(doc).toHaveProperty('expirationDate', '2029-01-15T00:00:00.000Z');
    });

    it('does NOT include expirationDate when not provided', () => {
      const doc = buildVCDocument({
        issuerDid: 'did:key:zIssuer',
        holderDid: 'did:key:zHolder',
        credentialType: 'Cert',
        credentialSubject: {},
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      expect(doc).not.toHaveProperty('expirationDate');
    });

    it('accepts an array of credential types', () => {
      const doc = buildVCDocument({
        issuerDid: 'did:key:zIssuer',
        holderDid: 'did:key:zHolder',
        credentialType: ['HealthCredential', 'NursingCertificate'],
        credentialSubject: {},
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      expect(doc.type).toContain('VerifiableCredential');
      expect(doc.type).toContain('HealthCredential');
      expect(doc.type).toContain('NursingCertificate');
    });
  });

  // ── issueVC ─────────────────────────────────────────────────────────────────

  describe('issueVC', () => {
    it('returns a signed VC with proof.type = Ed25519Signature2020', async () => {
      const orgId = 'test-org-uuid';
      process.env[`ORG_PRIVATE_KEY_${orgId}`] = 'zMockPrivateKeyMultibase';

      const signedVCMock = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        proof: {
          type: 'Ed25519Signature2020',
          proofValue: 'zMockProofValue',
          created: '2024-01-15T00:00:00Z',
          verificationMethod: 'did:key:zMockKey#zMockKey',
          proofPurpose: 'assertionMethod',
        },
      };
      mockIssue.mockResolvedValue(signedVCMock);

      const unsignedVC = buildVCDocument({
        issuerDid: 'did:key:zMockKey',
        holderDid: 'did:passport:holder:test',
        credentialType: 'NursingCertificate',
        credentialSubject: { title: 'Registered Nurse' },
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      const result = await issueVC(unsignedVC, orgId, 'did:key:zMockKey#zMockKey');

      expect(result).toHaveProperty('proof');
      expect(result.proof.type).toBe('Ed25519Signature2020');
      expect(result.proof.proofValue).toBe('zMockProofValue');
    });

    it('throws if the org private key env var is not set', async () => {
      const missingOrgId = 'org-with-no-key';
      delete process.env[`ORG_PRIVATE_KEY_${missingOrgId}`];

      const unsignedVC = buildVCDocument({
        issuerDid: 'did:key:z1',
        holderDid: 'did:key:z2',
        credentialType: 'Cert',
        credentialSubject: {},
        issuanceDate: '2024-01-15T00:00:00.000Z',
      });

      await expect(issueVC(unsignedVC, missingOrgId, 'did:key:z1#z1')).rejects.toThrow(
        /private key not found/i
      );
    });
  });

  // ── verifyVC ────────────────────────────────────────────────────────────────

  describe('verifyVC', () => {
    const samplePublicKeyJwk = {
      id: 'did:key:zMockKey#zMockKey',
      type: 'Ed25519VerificationKey2020',
      publicKeyMultibase: 'zMockPublicKey',
    };

    it('returns verified:true for a valid signature', async () => {
      mockVerifyCredential.mockResolvedValue({ verified: true, error: null });

      const signedVC = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        proof: {
          type: 'Ed25519Signature2020',
          proofValue: 'zMockProofValue',
        },
      };

      const result = await verifyVC(signedVC, samplePublicKeyJwk);

      expect(result.verified).toBe(true);
      expect(result.checks).toContain('proof');
    });

    it('returns verified:false for a tampered document', async () => {
      mockVerifyCredential.mockResolvedValue({
        verified: false,
        error: new Error('Proof verification failed'),
      });

      const tamperedVC = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        credentialSubject: { id: 'did:key:tampered', title: 'FAKE' },
        proof: {
          type: 'Ed25519Signature2020',
          proofValue: 'zInvalidProof',
        },
      };

      const result = await verifyVC(tamperedVC, samplePublicKeyJwk);

      expect(result.verified).toBe(false);
    });

    it('returns verified:false and error message when verification throws', async () => {
      mockVerifyCredential.mockRejectedValue(new Error('Crypto error'));

      const vc = {
        '@context': [],
        type: ['VerifiableCredential'],
        proof: { type: 'Ed25519Signature2020', proofValue: 'z' },
      };

      const result = await verifyVC(vc, samplePublicKeyJwk);

      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/Crypto error/);
    });

    it('returns verified:false when credential is expired', async () => {
      mockVerifyCredential.mockResolvedValue({ verified: true, error: null });

      const expiredVC = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        expirationDate: '2020-01-01T00:00:00.000Z', // past
        proof: {
          type: 'Ed25519Signature2020',
          proofValue: 'zMockProofValue',
        },
      };

      const result = await verifyVC(expiredVC, samplePublicKeyJwk);

      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/expired/i);
    });
  });
});
