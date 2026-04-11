/**
 * Seed script — run with: npm run seed
 * Creates demo data for Mushimiyimana Synthia:
 *   - The holder account (if not already present)
 *   - A fictitious issuing organisation
 *   - 3 credentials (secondary school verified, diploma NOT verified, language cert)
 *   - 4 work-experience entries (some verified, some not)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import PassportHolder     from '../models/PassportHolder.js';
import IssuingOrganization from '../models/IssuingOrganization.js';
import Credential         from '../models/Credential.js';
import WorkExperience     from '../models/WorkExperience.js';

// ─── Synthia's fixed ObjectId so references stay stable ───────────────────────
const SYNTHIA_ID = new mongoose.Types.ObjectId('69da20908d10fec8cfbcb466');

async function seed() {
  await connectDB();

  // ── 1. Holder ──────────────────────────────────────────────────────────────
  let holder = await PassportHolder.findOne({ email: 'cynthiamushimiyimana9@gmail.com' });
  if (!holder) {
    const password_hash = await bcrypt.hash('Wallstreet345', 12);
    holder = await PassportHolder.create({
      _id:           SYNTHIA_ID,
      full_name:     'Mushimiyimana Synthia',
      date_of_birth: new Date('2007-07-09'),
      nationality:   'Congolese',
      email:         'cynthiamushimiyimana9@gmail.com',
      phone:         '+250789541528',
      role:          'holder',
      bio:           'Motivated young professional from the Democratic Republic of Congo. ' +
                     'Completed secondary school with distinction and currently pursuing a ' +
                     'diploma in Business Administration. Experienced in retail, hospitality ' +
                     'and community outreach, with a strong work ethic and a passion for growth.',
      password_hash,
    });
    console.log(`✅ Created holder: ${holder.full_name} (${holder._id})`);
  } else {
    // Patch bio if missing
    if (!holder.bio) {
      await PassportHolder.findByIdAndUpdate(holder._id, {
        bio: 'Motivated young professional from the Democratic Republic of Congo. ' +
             'Completed secondary school with distinction and currently pursuing a ' +
             'diploma in Business Administration. Experienced in retail, hospitality ' +
             'and community outreach, with a strong work ethic and a passion for growth.',
      });
    }
    console.log(`✓ Holder already exists — skipping creation (${holder._id})`);
  }

  const holderId = holder._id;

  // ── 2. Issuing organisations ───────────────────────────────────────────────
  const orgDefs = [
    {
      _id:  new mongoose.Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'),
      name: 'Institut Supérieur de Commerce de Kinshasa',
      type: 'academic',
      did:  'did:web:isc-kinshasa.cd',
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'mock_x_isc', y: 'mock_y_isc' },
      verified: true,
    },
    {
      _id:  new mongoose.Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb'),
      name: 'Alliance Française de Kinshasa',
      type: 'academic',
      did:  'did:web:alliance-francaise.cd',
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'mock_x_af', y: 'mock_y_af' },
      verified: true,
    },
    {
      _id:  new mongoose.Types.ObjectId('cccccccccccccccccccccccc'),
      name: 'UNHCR Livelihood Programme DRC',
      type: 'ngo',
      did:  'did:web:unhcr-livelihoods.org',
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'mock_x_un', y: 'mock_y_un' },
      verified: true,
    },
  ];

  const orgs = {};
  for (const def of orgDefs) {
    const existing = await IssuingOrganization.findById(def._id);
    if (!existing) {
      const org = await IssuingOrganization.create(def);
      orgs[def.name] = org;
      console.log(`  ✅ Created org: ${org.name}`);
    } else {
      orgs[def.name] = existing;
      console.log(`  ✓ Org exists: ${existing.name}`);
    }
  }

  // ── 3. Credentials ─────────────────────────────────────────────────────────
  // Clear existing credentials for this holder so the seed is idempotent
  await Credential.deleteMany({ holder_id: holderId });

  const credDefs = [
    // ① Secondary school — VERIFIED ✓
    {
      holder_id:   holderId,
      issuer_id:   orgs['Institut Supérieur de Commerce de Kinshasa']._id,
      type:        'EducationDegree',
      title:       'Certificate of Secondary Education — Sciences Humaines',
      description: 'National secondary school leaving certificate awarded upon successful ' +
                   'completion of the Humanités Scientifiques programme at Lycée Bomoko, ' +
                   'Kinshasa. Result: Distinction (84%). Recognised by the DRC Ministry of ' +
                   'Primary, Secondary and Professional Education.',
      issued_at:   new Date('2024-07-15'),
      expires_at:  null,
      status:      'active',
      vc_json: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'EducationDegree'],
        issuer: 'did:web:isc-kinshasa.cd',
        issuanceDate: '2024-07-15T00:00:00Z',
        credentialSubject: {
          name: 'Mushimiyimana Synthia',
          qualification: 'Certificate of Secondary Education',
          result: 'Distinction',
          grade: '84%',
        },
      },
      proof_value: 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImRpZDp3ZWI6aXNjLWtpbnNoYXNhLmNkIn0.SECONDARY_MOCK_PROOF',
    },

    // ② Business Administration Diploma — NOT YET VERIFIED ✗
    {
      holder_id:   holderId,
      issuer_id:   orgs['Institut Supérieur de Commerce de Kinshasa']._id,
      type:        'VocationalCertificate',
      title:       'Diploma in Business Administration (Year 1 — in progress)',
      description: 'First-year diploma programme in Business Administration at the Institut ' +
                   'Supérieur de Commerce de Kinshasa. Covering accounting, management ' +
                   'principles, marketing and entrepreneurship. Verification pending issuer ' +
                   'countersignature upon completion of final examinations.',
      issued_at:   new Date('2025-02-01'),
      expires_at:  null,
      status:      'active',         // credential exists but not countersigned
      vc_json: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'VocationalCertificate'],
        issuer: 'did:web:isc-kinshasa.cd',
        issuanceDate: '2025-02-01T00:00:00Z',
        credentialSubject: {
          name: 'Mushimiyimana Synthia',
          programme: 'Business Administration — Year 1',
          status: 'In Progress',
        },
      },
      proof_value: 'PENDING_VERIFICATION',   // unverified — no real signature yet
    },

    // ③ French Language Proficiency — VERIFIED ✓
    {
      holder_id:   holderId,
      issuer_id:   orgs['Alliance Française de Kinshasa']._id,
      type:        'LanguageTest',
      title:       'DELF B1 — Diplôme d\'Études en Langue Française',
      description: 'DELF B1 certification issued by Alliance Française de Kinshasa, ' +
                   'accredited by the French Ministry of National Education. Demonstrates ' +
                   'independent user level in French: reading, writing, listening and speaking. ' +
                   'Score: 72.5 / 100.',
      issued_at:   new Date('2024-03-20'),
      expires_at:  null,           // DELF certificates do not expire
      status:      'active',
      vc_json: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'LanguageTest'],
        issuer: 'did:web:alliance-francaise.cd',
        issuanceDate: '2024-03-20T00:00:00Z',
        credentialSubject: {
          name: 'Mushimiyimana Synthia',
          language: 'French',
          level: 'B1',
          score: '72.5/100',
          framework: 'CEFR',
        },
      },
      proof_value: 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImRpZDp3ZWI6YWxsaWFuY2UtZnJhbmNhaXNlLmNkIn0.DELF_MOCK_PROOF',
    },
  ];

  for (const def of credDefs) {
    const cred = await Credential.create(def);
    const verified = def.proof_value !== 'PENDING_VERIFICATION';
    console.log(`  ✅ Credential: "${cred.title}" — ${verified ? '✓ verified' : '✗ unverified'}`);
  }

  // ── 4. Work experience ─────────────────────────────────────────────────────
  await WorkExperience.deleteMany({ holder_id: holderId });

  const workDefs = [
    // ① Supermarket cashier — VERIFIED ✓ (employer confirmed)
    {
      holder_id:    holderId,
      employer_name: 'Shoprite Kinshasa — Limete Branch',
      job_title:    'Cashier & Customer Service Representative',
      start_date:   new Date('2023-06-01'),
      end_date:     new Date('2024-01-31'),
      is_current:   false,
      location:     'Kinshasa, DRC',
      verified:     true,
      description:  'Processed customer transactions at high-volume retail checkout. ' +
                    'Handled cash, mobile money (M-Pesa) and card payments. ' +
                    'Maintained daily reconciliation with zero discrepancies over 8 months. ' +
                    'Received "Employee of the Month" in October 2023.',
    },

    // ② Community health outreach — VERIFIED ✓ (NGO confirmed)
    {
      holder_id:    holderId,
      employer_name: 'UNHCR Livelihood Programme DRC',
      job_title:    'Community Outreach Volunteer',
      start_date:   new Date('2022-09-01'),
      end_date:     new Date('2023-05-30'),
      is_current:   false,
      location:     'Goma, North Kivu, DRC',
      verified:     true,
      description:  'Supported UNHCR livelihood teams in conducting household needs ' +
                    'assessments across three refugee settlements in North Kivu. ' +
                    'Facilitated community meetings in Swahili and Kinyarwanda. ' +
                    'Documented over 400 family profiles used for targeted assistance.',
    },

    // ③ Private tutoring — NOT VERIFIED ✗
    {
      holder_id:    holderId,
      employer_name: 'Self-employed',
      job_title:    'Private Mathematics & French Tutor',
      start_date:   new Date('2024-02-01'),
      end_date:     null,
      is_current:   true,
      location:     'Kinshasa, DRC',
      verified:     false,
      description:  'Provides one-on-one and small-group tutoring for secondary school ' +
                    'students in mathematics (up to baccalaureate level) and French grammar. ' +
                    'Currently serving 6 regular students. Verification pending — ' +
                    'no institutional employer to countersign.',
    },

    // ④ Hotel front desk intern — NOT VERIFIED ✗
    {
      holder_id:    holderId,
      employer_name: 'Hôtel Memling Kinshasa',
      job_title:    'Front Desk Intern',
      start_date:   new Date('2024-07-01'),
      end_date:     new Date('2024-09-30'),
      is_current:   false,
      location:     'Kinshasa, DRC',
      verified:     false,
      description:  'Three-month internship in the hospitality sector as part of the ' +
                    'Business Administration curriculum. Handled guest check-in/out, ' +
                    'reservation management and multi-line telephone switchboard. ' +
                    'Gained proficiency in Fidelio PMS. Verification requested but ' +
                    'not yet returned by the property manager.',
    },
  ];

  for (const def of workDefs) {
    const entry = await WorkExperience.create(def);
    console.log(`  ✅ Work: "${entry.job_title}" at ${entry.employer_name} — ${entry.verified ? '✓ verified' : '✗ unverified'}`);
  }

  await mongoose.disconnect();
  console.log('\nDone. Synthia\'s profile is fully seeded.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
