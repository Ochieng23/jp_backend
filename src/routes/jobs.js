import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as kaziniJobsService from '../services/kaziniJobsService.js';
import * as holderRepository from '../repositories/holderRepository.js';
import JobApplication from '../models/JobApplication.js';

const router = Router();

const applySchema = Joi.object({
  // Only required for guest (unauthenticated) applicants — a signed-in
  // holder's name/email/phone come from their profile instead.
  first_name: Joi.string().max(120),
  last_name: Joi.string().max(120),
  email: Joi.string().email({ tlds: false }),
  phone: Joi.string().max(30),
  resume_url: Joi.string().uri().required(),
  cover_letter: Joi.string().max(500).allow('', null),
  how_heard: Joi.string().valid('Website', 'Social Media', 'Friend', 'Job Board', 'Other').default('Job Board'),
  portfolio_link: Joi.string().uri().allow('', null),
  work_profile: Joi.string().uri().allow('', null),
  work_samples: Joi.string().uri().allow('', null),
  custom_answers: Joi.array()
    .items(
      Joi.object({
        question: Joi.string().required(),
        answer: Joi.string().allow('').default(''),
      })
    )
    .default([]),
  // One entry per non-résumé, non-URL-only requiredDocument the job asks
  // for (uploaded via POST /uploads first). `name` must exactly match the
  // requiredDocument's display name — the matching fieldName kazini_backend
  // actually checks against is re-derived from it server-side (see
  // toKaziniFieldName below), not sent by the client.
  documents: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        url: Joi.string().uri().required(),
      })
    )
    .default([]),
});

/**
 * Replicates kazini_backend's Application.controller.js `toFieldName()`
 * exactly. kazini_backend matches submitted documents against a job's
 * requiredDocuments by re-deriving this from the document's display name —
 * NOT by trusting the requiredDocument's own stored `fieldName` — so this
 * must mirror that derivation bug-for-bug or valid submissions get rejected.
 */
function toKaziniFieldName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_');
}

// kazini_backend requires E.164-ish digits-only (with optional leading +).
// Holders/guests commonly type spaces, dashes, or parens — strip everything
// but the leading + and digits before submitting so a display-friendly
// phone number doesn't fail validation at apply time.
function toE164(phone) {
  if (!phone) return phone;
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}
const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

/**
 * GET /api/jobs
 * Job board listing — proxied from kazini_backend, filtered/paginated here
 * since kazini_backend's GET /job has neither.
 */
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize, 10) || 20), 100);

    const { data, total } = await kaziniJobsService.listJobs({
      page,
      pageSize,
      location: req.query.location,
      jobType: req.query.jobType,
      experienceLevel: req.query.experienceLevel,
      contractType: req.query.contractType,
      skill: req.query.skill,
      search: req.query.search,
    });

    res.json({ data, total, page, pageSize, hasNext: page * pageSize < total });
  })
);

/**
 * GET /api/jobs/applications
 * The current holder's application history. Must be registered before
 * '/:id' so it isn't captured by that param route.
 */
router.get(
  '/applications',
  authenticate,
  asyncHandler(async (req, res) => {
    const applications = await JobApplication.find({ holder_id: req.user.id })
      .sort({ applied_at: -1 })
      .lean();
    res.json({ data: applications, total: applications.length });
  })
);

/**
 * GET /api/jobs/:id
 */
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const job = await kaziniJobsService.getJob(req.params.id);
    res.json({ data: job });
  })
);

/**
 * POST /api/jobs/:id/apply
 * Works both as a guest (no account — first/last name, email, phone taken
 * directly from the request body) and as a signed-in holder (name/email/phone
 * taken from their passport profile, and the application is additionally
 * recorded locally so it shows up under "my applications"). Either way the
 * submission to kazini_backend itself is identical.
 */
router.post(
  '/:id/apply',
  optionalAuth,
  validate(applySchema),
  asyncHandler(async (req, res) => {
    const job = await kaziniJobsService.getJob(req.params.id);
    if (!job.employer?.id) {
      return res.status(422).json({
        error: 'UNPROCESSABLE',
        message: 'This job has no associated employer and cannot accept applications',
        requestId: req.id,
      });
    }

    let firstName, lastName, email, phone, holderId;

    if (req.user) {
      const holder = await holderRepository.findHolderById(req.user.id);
      if (!holder) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
      }
      const [fn, ...rest] = (holder.full_name || '').trim().split(/\s+/);
      firstName = fn;
      lastName = rest.join(' ') || fn;
      email = holder.email;
      phone = holder.phone;
      holderId = req.user.id;
    } else {
      const missing = ['first_name', 'last_name', 'email', 'phone'].filter((f) => !req.body[f]);
      if (missing.length) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: `Missing required field(s): ${missing.join(', ')}`,
          requestId: req.id,
        });
      }
      firstName = req.body.first_name;
      lastName = req.body.last_name;
      email = req.body.email;
      phone = req.body.phone;
    }

    const normalizedPhone = toE164(phone);
    if (!PHONE_RE.test(normalizedPhone)) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Please provide a valid phone number, e.g. +254712345678',
        requestId: req.id,
      });
    }

    if (job.customQuestions.length !== req.body.custom_answers.length) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: `This job requires ${job.customQuestions.length} custom question answer(s)`,
        requestId: req.id,
      });
    }

    // requiredDocuments the 3 standard URL fields already cover.
    const URL_ONLY_FIELDS = { portfoliolink: req.body.portfolio_link, workprofile: req.body.work_profile, worksamples: req.body.work_samples };
    const RESUME_NAMES = new Set(['cv', 'resume', 'curriculumvitae']);

    const submittedDocsByName = new Map(req.body.documents.map((d) => [d.name, d]));
    for (const doc of job.requiredDocuments || []) {
      if (!doc.mandatory) continue;
      const key = toKaziniFieldName(doc.name).replace(/_/g, '');
      if (RESUME_NAMES.has(key)) continue; // covered by resume_url
      if (Object.prototype.hasOwnProperty.call(URL_ONLY_FIELDS, key)) {
        if (!URL_ONLY_FIELDS[key]) {
          return res.status(400).json({
            error: 'BAD_REQUEST',
            message: `This job requires a link for "${doc.name}"`,
            requestId: req.id,
          });
        }
        continue;
      }
      if (!submittedDocsByName.has(doc.name)) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: `This job requires a file upload for "${doc.name}"`,
          requestId: req.id,
        });
      }
    }

    const payload = {
      firstName,
      lastName,
      email,
      phone: normalizedPhone,
      howHeard: req.body.how_heard,
      coverLetter: req.body.cover_letter || undefined,
      resume: req.body.resume_url,
      portfolioLink: req.body.portfolio_link || undefined,
      workProfile: req.body.work_profile || undefined,
      workSamples: req.body.work_samples || undefined,
      documents: req.body.documents.map((d) => ({
        name: d.name,
        fieldName: toKaziniFieldName(d.name),
        url: d.url,
      })),
      customAnswers: job.customQuestions.map((q, i) => ({
        question: q.question,
        answer: req.body.custom_answers[i]?.answer ?? '',
      })),
      job: job.id,
      employer: job.employer.id,
    };

    let kaziniResult;
    try {
      kaziniResult = await kaziniJobsService.submitApplication(payload);
    } catch (err) {
      if (err.statusCode === 409) {
        return res.status(409).json({
          error: 'CONFLICT',
          message: err.message,
          requestId: req.id,
        });
      }
      throw err;
    }

    // Guests have no holder to link a local record to — nothing further to
    // track (kazini_backend itself now has the real application).
    if (!holderId) {
      return res.status(201).json({ data: { kazini_application_id: kaziniResult.applicationId } });
    }

    const record = await JobApplication.findOneAndUpdate(
      { holder_id: holderId, kazini_job_id: job.id },
      {
        $set: {
          kazini_application_id: kaziniResult.applicationId,
          kazini_employer_id: job.employer.id,
          job_title: job.title,
          employer_name: job.employer.name,
          status: 'Applied',
          applied_at: new Date(),
        },
      },
      { upsert: true, new: true }
    ).lean();

    res.status(201).json({ data: record });
  })
);

export default router;
