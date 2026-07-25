import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as kaziniJobsService from '../services/kaziniJobsService.js';
import * as holderRepository from '../repositories/holderRepository.js';
import JobApplication from '../models/JobApplication.js';

const router = Router();

const applySchema = Joi.object({
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
  documents: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        fieldName: Joi.string().required(),
        url: Joi.string().uri().required(),
      })
    )
    .default([]),
});

/**
 * GET /api/jobs
 * Job board listing — proxied from kazini_backend, filtered/paginated here
 * since kazini_backend's GET /job has neither.
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize, 10) || 20), 100);

    const { data, total } = await kaziniJobsService.listJobs({
      page,
      pageSize,
      location: req.query.location,
      jobType: req.query.jobType,
      experienceLevel: req.query.experienceLevel,
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
  authenticate,
  asyncHandler(async (req, res) => {
    const job = await kaziniJobsService.getJob(req.params.id);
    res.json({ data: job });
  })
);

/**
 * POST /api/jobs/:id/apply
 * Builds a kazini_backend Application payload from the holder's existing
 * passport profile and submits it server-to-server, then records a local
 * JobApplication so the holder can see it under "my applications".
 */
router.post(
  '/:id/apply',
  authenticate,
  validate(applySchema),
  asyncHandler(async (req, res) => {
    const job = await kaziniJobsService.getJob(req.params.id);
    const holder = await holderRepository.findHolderById(req.user.id);
    if (!holder) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }
    if (!job.employer?.id) {
      return res.status(422).json({
        error: 'UNPROCESSABLE',
        message: 'This job has no associated employer and cannot accept applications',
        requestId: req.id,
      });
    }

    const [firstName, ...rest] = (holder.full_name || '').trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    if (job.customQuestions.length !== req.body.custom_answers.length) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: `This job requires ${job.customQuestions.length} custom question answer(s)`,
        requestId: req.id,
      });
    }

    const payload = {
      firstName,
      lastName,
      email: holder.email,
      phone: holder.phone,
      howHeard: req.body.how_heard,
      coverLetter: req.body.cover_letter || undefined,
      resume: req.body.resume_url,
      portfolioLink: req.body.portfolio_link || undefined,
      workProfile: req.body.work_profile || undefined,
      workSamples: req.body.work_samples || undefined,
      documents: req.body.documents,
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

    const record = await JobApplication.findOneAndUpdate(
      { holder_id: req.user.id, kazini_job_id: job.id },
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
