import { jest } from '@jest/globals';

// ─── Mock dependencies ─────────────────────────────────────────────────────────

const mockFindCredentialById = jest.fn();
jest.unstable_mockModule('../repositories/credentialRepository.js', () => ({
  findCredentialById: mockFindCredentialById,
  findCredentialsByHolder: jest.fn(),
}));

const mockFindJurisdictionById = jest.fn();
jest.unstable_mockModule('../repositories/jurisdictionRepository.js', () => ({
  findById: mockFindJurisdictionById,
}));

const mockUpsertRecognition = jest.fn();
const mockFindByCredentialAndJurisdiction = jest.fn();
const mockGetRecognitionMatrix = jest.fn();
jest.unstable_mockModule('../repositories/recognitionRepository.js', () => ({
  upsertRecognition: mockUpsertRecognition,
  findByCredentialAndJurisdiction: mockFindByCredentialAndJurisdiction,
  getRecognitionMatrix: mockGetRecognitionMatrix,
  findByHolder: jest.fn().mockResolvedValue([]),
}));

const mockLogAction = jest.fn();
jest.unstable_mockModule('../repositories/auditRepository.js', () => ({
  logAction: mockLogAction,
}));

jest.unstable_mockModule('../config/queue.js', () => ({
  jurisdictionSyncQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  notificationQueue: { add: jest.fn() },
}));

// ─── Import service ───────────────────────────────────────────────────────────

const {
  evaluateRecognition,
  getRecognitionMatrix,
} = await import('../services/recognitionService.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleCredential = {
  id: 'cred-uuid-1',
  holder_id: 'holder-uuid-1',
  type: 'NursingCertificate',
  title: 'Registered Nurse',
  status: 'active',
};

const sampleJurisdictionWithRules = {
  id: 'jur-uuid-1',
  country_name: 'Testland',
  country_code: 'TST',
  recognition_rules: {
    NursingCertificate: {
      status: 'recognised',
      equivalent_type: 'RegisteredNurse',
      notes: 'Direct equivalence under TST Nursing Act',
    },
    WeldingCertificate: {
      status: 'partial',
      equivalent_type: 'WelderGrade2',
    },
  },
};

const sampleJurisdictionNoRules = {
  id: 'jur-uuid-2',
  country_name: 'Emptyville',
  country_code: 'EMP',
  recognition_rules: {},
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('recognitionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── evaluateRecognition ─────────────────────────────────────────────────────

  describe('evaluateRecognition', () => {
    it('maps credential type via recognition_rules and returns recognised status', async () => {
      mockFindCredentialById.mockResolvedValue(sampleCredential);
      mockFindJurisdictionById.mockResolvedValue(sampleJurisdictionWithRules);
      mockFindByCredentialAndJurisdiction.mockResolvedValue(null); // no existing row
      mockUpsertRecognition.mockResolvedValue({
        id: 'rec-uuid-1',
        source_credential_id: 'cred-uuid-1',
        target_jurisdiction_id: 'jur-uuid-1',
        recognition_status: 'recognised',
        equivalent_type: 'RegisteredNurse',
        evaluated_at: new Date().toISOString(),
      });
      mockLogAction.mockResolvedValue({});

      const result = await evaluateRecognition('cred-uuid-1', 'jur-uuid-1');

      expect(mockUpsertRecognition).toHaveBeenCalledWith(
        expect.objectContaining({
          recognition_status: 'recognised',
          equivalent_type: 'RegisteredNurse',
          source_credential_id: 'cred-uuid-1',
          target_jurisdiction_id: 'jur-uuid-1',
        })
      );
      expect(result.recognition_status).toBe('recognised');
    });

    it('sets not_recognised when credential type is not in recognition_rules', async () => {
      const unknownTypeCredential = { ...sampleCredential, type: 'UnknownDegree' };
      mockFindCredentialById.mockResolvedValue(unknownTypeCredential);
      mockFindJurisdictionById.mockResolvedValue(sampleJurisdictionWithRules);
      mockFindByCredentialAndJurisdiction.mockResolvedValue(null);
      mockUpsertRecognition.mockResolvedValue({
        id: 'rec-uuid-2',
        source_credential_id: 'cred-uuid-1',
        target_jurisdiction_id: 'jur-uuid-1',
        recognition_status: 'not_recognised',
        equivalent_type: null,
      });
      mockLogAction.mockResolvedValue({});

      await evaluateRecognition('cred-uuid-1', 'jur-uuid-1');

      expect(mockUpsertRecognition).toHaveBeenCalledWith(
        expect.objectContaining({
          recognition_status: 'not_recognised',
          equivalent_type: null,
        })
      );
    });

    it('sets not_recognised when jurisdiction has empty recognition_rules', async () => {
      mockFindCredentialById.mockResolvedValue(sampleCredential);
      mockFindJurisdictionById.mockResolvedValue(sampleJurisdictionNoRules);
      mockFindByCredentialAndJurisdiction.mockResolvedValue(null);
      mockUpsertRecognition.mockResolvedValue({
        id: 'rec-uuid-3',
        recognition_status: 'not_recognised',
        equivalent_type: null,
      });
      mockLogAction.mockResolvedValue({});

      await evaluateRecognition('cred-uuid-1', 'jur-uuid-2');

      expect(mockUpsertRecognition).toHaveBeenCalledWith(
        expect.objectContaining({ recognition_status: 'not_recognised' })
      );
    });

    it('logs audit event with before and after metadata', async () => {
      const existingRecognition = {
        id: 'rec-uuid-existing',
        recognition_status: 'pending',
        equivalent_type: null,
      };
      mockFindCredentialById.mockResolvedValue(sampleCredential);
      mockFindJurisdictionById.mockResolvedValue(sampleJurisdictionWithRules);
      mockFindByCredentialAndJurisdiction.mockResolvedValue(existingRecognition);
      mockUpsertRecognition.mockResolvedValue({
        id: 'rec-uuid-existing',
        recognition_status: 'recognised',
        equivalent_type: 'RegisteredNurse',
      });
      mockLogAction.mockResolvedValue({});

      await evaluateRecognition('cred-uuid-1', 'jur-uuid-1');

      expect(mockLogAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'recognition.evaluated',
          metadata: expect.objectContaining({
            before: expect.objectContaining({
              recognition_status: 'pending',
            }),
            after: expect.objectContaining({
              recognition_status: 'recognised',
            }),
          }),
        })
      );
    });

    it('throws 404 when credential is not found', async () => {
      mockFindCredentialById.mockResolvedValue(null);
      mockFindJurisdictionById.mockResolvedValue(sampleJurisdictionWithRules);

      await expect(
        evaluateRecognition('nonexistent-cred', 'jur-uuid-1')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 404 when jurisdiction is not found', async () => {
      mockFindCredentialById.mockResolvedValue(sampleCredential);
      mockFindJurisdictionById.mockResolvedValue(null);

      await expect(
        evaluateRecognition('cred-uuid-1', 'nonexistent-jur')
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ── getRecognitionMatrix ────────────────────────────────────────────────────

  describe('getRecognitionMatrix', () => {
    it('returns correct matrix structure from repository', async () => {
      const matrixData = [
        {
          credential_id: 'cred-uuid-1',
          credential_title: 'Registered Nurse',
          credential_type: 'NursingCertificate',
          credential_status: 'active',
          issued_at: '2024-01-15T00:00:00.000Z',
          expires_at: null,
          home_jurisdiction: 'Testland',
          recognitions: [
            {
              jurisdiction_id: 'jur-uuid-2',
              jurisdiction_name: 'Emptyville',
              country_code: 'EMP',
              recognition_status: 'not_recognised',
              equivalent_type: null,
              notes: null,
              evaluated_at: '2024-06-01T00:00:00.000Z',
            },
          ],
        },
      ];
      mockGetRecognitionMatrix.mockResolvedValue(matrixData);

      const result = await getRecognitionMatrix('holder-uuid-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('credential_id', 'cred-uuid-1');
      expect(result[0]).toHaveProperty('recognitions');
      expect(result[0].recognitions).toHaveLength(1);
      expect(result[0].recognitions[0]).toHaveProperty('recognition_status', 'not_recognised');
    });

    it('returns an empty array when holder has no credentials', async () => {
      mockGetRecognitionMatrix.mockResolvedValue([]);

      const result = await getRecognitionMatrix('holder-uuid-empty');
      expect(result).toEqual([]);
    });
  });
});
