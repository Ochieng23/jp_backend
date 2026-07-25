import { jest } from '@jest/globals';

// ─── Mock dependencies before importing the service ───────────────────────────

const mockCreateCredential = jest.fn();
const mockFindCredentialById = jest.fn();
const mockUpdateCredentialStatus = jest.fn();
const mockGetCredentialWithIssuer = jest.fn();
const mockFindCredentialsByHolder = jest.fn();

jest.unstable_mockModule('../repositories/credentialRepository.js', () => ({
  createCredential: mockCreateCredential,
  findCredentialById: mockFindCredentialById,
  updateCredentialStatus: mockUpdateCredentialStatus,
  getCredentialWithIssuer: mockGetCredentialWithIssuer,
  findCredentialsByHolder: mockFindCredentialsByHolder,
}));

const mockFindHolderById = jest.fn();
jest.unstable_mockModule('../repositories/holderRepository.js', () => ({
  findHolderById: mockFindHolderById,
}));

const mockFindOrgById = jest.fn();
jest.unstable_mockModule('../repositories/organizationRepository.js', () => ({
  findById: mockFindOrgById,
}));

const mockLogAction = jest.fn();
jest.unstable_mockModule('../repositories/auditRepository.js', () => ({
  logAction: mockLogAction,
}));

const mockBuildVCDocument = jest.fn();
const mockIssueVC = jest.fn();
const mockVerifyVC = jest.fn();
jest.unstable_mockModule('../utils/vcUtils.js', () => ({
  buildVCDocument: mockBuildVCDocument,
  issueVC: mockIssueVC,
  verifyVC: mockVerifyVC,
}));

const mockFindByHolder = jest.fn();
jest.unstable_mockModule('../repositories/recognitionRepository.js', () => ({
  findByHolder: mockFindByHolder,
}));

const mockEvaluateRecognition = jest.fn();
jest.unstable_mockModule('../services/recognitionService.js', () => ({
  evaluateRecognition: mockEvaluateRecognition,
}));

// ─── Import service after all mocks are in place ──────────────────────────────

const {
  selfReportCredential,
  issueCredential,
  revokeCredential,
  verifyCredential,
} = await import('../services/credentialService.js');

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('credentialService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── selfReportCredential ────────────────────────────────────────────────────

  describe('selfReportCredential', () => {
    it('creates a credential with the correct fields', async () => {
      const holderId = 'holder-uuid-1';
      const orgId = 'org-uuid-1';

      mockFindHolderById.mockResolvedValue({ id: holderId, full_name: 'Test User' });
      mockFindOrgById.mockResolvedValue({ id: orgId, did: 'did:key:ztest', verified: true });
      mockBuildVCDocument.mockReturnValue({ '@context': [], type: ['VerifiableCredential'] });
      mockCreateCredential.mockResolvedValue({
        id: 'cred-uuid-1',
        holder_id: holderId,
        issuer_id: orgId,
        type: 'NursingCertificate',
        title: 'Registered Nurse',
        status: 'active',
        proof_value: 'self-reported',
      });
      mockLogAction.mockResolvedValue({});

      const data = {
        type: 'NursingCertificate',
        title: 'Registered Nurse',
        issued_at: '2024-01-15T00:00:00.000Z',
        issuer_id: orgId,
        jurisdiction_id: 'jur-uuid-1',
      };

      const result = await selfReportCredential(holderId, data);

      expect(mockCreateCredential).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateCredential.mock.calls[0][0];
      expect(callArgs.holder_id).toBe(holderId);
      expect(callArgs.issuer_id).toBe(orgId);
      expect(callArgs.type).toBe('NursingCertificate');
      expect(callArgs.title).toBe('Registered Nurse');
      expect(callArgs.status).toBe('active');
      expect(callArgs.proof_value).toBe('self-reported');
      expect(result.id).toBe('cred-uuid-1');
    });

    it('throws 404 when holder is not found', async () => {
      mockFindHolderById.mockResolvedValue(null);

      await expect(
        selfReportCredential('nonexistent-holder', { issuer_id: 'org-id' })
      ).rejects.toMatchObject({ statusCode: 404, message: 'Holder not found' });
    });

    it('throws 404 when org is not found', async () => {
      mockFindHolderById.mockResolvedValue({ id: 'holder-id' });
      mockFindOrgById.mockResolvedValue(null);

      await expect(
        selfReportCredential('holder-id', { issuer_id: 'bad-org' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('logs a credential.self_reported audit event', async () => {
      mockFindHolderById.mockResolvedValue({ id: 'holder-1' });
      mockFindOrgById.mockResolvedValue({ id: 'org-1', did: 'did:key:z1', verified: false });
      mockBuildVCDocument.mockReturnValue({});
      mockCreateCredential.mockResolvedValue({ id: 'cred-1', holder_id: 'holder-1' });
      mockLogAction.mockResolvedValue({});

      await selfReportCredential('holder-1', {
        type: 'WeldingCert',
        title: 'Welder Grade 1',
        issued_at: '2024-01-01T00:00:00.000Z',
        issuer_id: 'org-1',
      });

      expect(mockLogAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'credential.self_reported' })
      );
    });
  });

  // ── issueCredential ─────────────────────────────────────────────────────────

  describe('issueCredential', () => {
    it('calls vcUtils.issueVC and evaluates recognition synchronously', async () => {
      const orgId = 'org-uuid-2';
      const holderId = 'holder-uuid-2';

      mockFindOrgById.mockResolvedValue({
        id: orgId,
        did: 'did:key:zissuer',
        verified: true,
        jurisdiction_id: 'jur-1',
      });
      mockFindHolderById.mockResolvedValue({ id: holderId });
      mockBuildVCDocument.mockReturnValue({ '@context': [], type: ['VerifiableCredential'] });
      mockIssueVC.mockResolvedValue({
        '@context': [],
        type: ['VerifiableCredential'],
        proof: { proofValue: 'z-sig-value', type: 'Ed25519Signature2020' },
      });
      mockCreateCredential.mockResolvedValue({
        id: 'cred-2',
        holder_id: holderId,
        issuer_id: orgId,
        jurisdiction_id: 'jur-1',
        type: 'NursingDiploma',
      });
      mockFindCredentialsByHolder.mockResolvedValue({
        rows: [{ id: 'cred-2', jurisdiction_id: 'jur-1' }],
        total: 1,
      });
      mockFindByHolder.mockResolvedValue([]);
      mockEvaluateRecognition.mockResolvedValue({ id: 'recognition-1' });
      mockLogAction.mockResolvedValue({});

      const data = {
        type: 'NursingDiploma',
        title: 'Diploma in Nursing',
        credential_subject: { institution: 'City Hospital' },
      };

      const result = await issueCredential(orgId, holderId, data);

      expect(mockIssueVC).toHaveBeenCalledTimes(1);
      expect(mockEvaluateRecognition).toHaveBeenCalledWith('cred-2', 'jur-1');
      expect(result.id).toBe('cred-2');
    });

    it('throws 403 when organisation is not verified', async () => {
      mockFindOrgById.mockResolvedValue({ id: 'org-1', verified: false });
      mockFindHolderById.mockResolvedValue({ id: 'holder-1' });

      await expect(
        issueCredential('org-1', 'holder-1', { type: 'X', title: 'Y', credential_subject: {} })
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── revokeCredential ────────────────────────────────────────────────────────

  describe('revokeCredential', () => {
    it('rejects if actor is not the issuer and not a platform_admin', async () => {
      mockFindCredentialById.mockResolvedValue({
        id: 'cred-3',
        issuer_id: 'org-A',
        status: 'active',
        holder_id: 'holder-3',
      });

      await expect(
        revokeCredential('cred-3', 'org-B', 'org_admin')
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows revocation by the issuing org_admin', async () => {
      mockFindCredentialById.mockResolvedValue({
        id: 'cred-4',
        issuer_id: 'org-A',
        status: 'active',
        holder_id: 'holder-4',
        jurisdiction_id: null,
      });
      mockUpdateCredentialStatus.mockResolvedValue({
        id: 'cred-4',
        status: 'revoked',
      });
      mockLogAction.mockResolvedValue({});

      const result = await revokeCredential('cred-4', 'org-A', 'org_admin');
      expect(result.status).toBe('revoked');
    });

    it('allows revocation by platform_admin regardless of issuer', async () => {
      mockFindCredentialById.mockResolvedValue({
        id: 'cred-5',
        issuer_id: 'org-Z',
        status: 'active',
        holder_id: 'holder-5',
        jurisdiction_id: null,
      });
      mockUpdateCredentialStatus.mockResolvedValue({ id: 'cred-5', status: 'revoked' });
      mockLogAction.mockResolvedValue({});

      const result = await revokeCredential('cred-5', 'admin-1', 'platform_admin');
      expect(result.status).toBe('revoked');
    });

    it('throws 409 if credential is already revoked', async () => {
      mockFindCredentialById.mockResolvedValue({
        id: 'cred-6',
        issuer_id: 'org-A',
        status: 'revoked',
      });

      await expect(
        revokeCredential('cred-6', 'org-A', 'org_admin')
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  // ── verifyCredential ────────────────────────────────────────────────────────

  describe('verifyCredential', () => {
    it('returns valid:false if credential status is revoked', async () => {
      mockGetCredentialWithIssuer.mockResolvedValue({
        id: 'cred-7',
        holder_id: 'holder-7',
        status: 'revoked',
        proof_value: 'z-proof',
        vc_json: {},
        issuer: { id: 'org-1', public_key_jwk: {} },
      });

      const result = await verifyCredential('cred-7');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
    });

    it('returns valid:false if credential is expired', async () => {
      mockGetCredentialWithIssuer.mockResolvedValue({
        id: 'cred-8',
        holder_id: 'holder-8',
        status: 'active',
        expires_at: '2020-01-01T00:00:00.000Z', // in the past
        proof_value: 'z-proof',
        vc_json: {},
        issuer: { id: 'org-1', public_key_jwk: {} },
      });

      const result = await verifyCredential('cred-8');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/i);
    });

    it('returns valid:true for an active non-expired self-reported credential', async () => {
      mockGetCredentialWithIssuer.mockResolvedValue({
        id: 'cred-9',
        holder_id: 'holder-9',
        status: 'active',
        expires_at: '2099-01-01T00:00:00.000Z',
        proof_value: 'self-reported',
        vc_json: {},
        issuer: { id: 'org-1', public_key_jwk: {} },
      });

      const result = await verifyCredential('cred-9');
      expect(result.valid).toBe(true);
    });

    it('throws 404 when credential is not found', async () => {
      mockGetCredentialWithIssuer.mockResolvedValue(null);

      await expect(verifyCredential('nonexistent')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
