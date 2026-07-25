import logger from '../utils/logger.js';

const CACHE_TTL_MS = 60_000;
let cache = { data: null, fetchedAt: 0 };

function baseUrl() {
  const url = process.env.KAZINI_BACKEND_URL;
  if (!url) {
    const err = new Error('KAZINI_BACKEND_URL is not configured');
    err.statusCode = 501;
    throw err;
  }
  return url;
}

/**
 * kazini_backend's GET /job has no server-side pagination or filtering — it
 * returns every active job in one array. Fetch once and cache briefly so the
 * job board doesn't re-fetch the whole list on every request.
 */
async function fetchAllJobs() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const res = await fetch(`${baseUrl()}/job`);
  if (!res.ok) {
    const err = new Error(`kazini_backend returned ${res.status} for GET /job`);
    err.statusCode = 502;
    throw err;
  }
  const jobs = await res.json();
  cache = { data: jobs, fetchedAt: now };
  return jobs;
}

function summarizeJob(job) {
  return {
    id: job._id,
    title: job.title,
    location: job.location,
    jobType: job.jobType,
    contract_type: job.contract_type,
    experienceLevel: job.experienceLevel,
    educationLevel: job.educationLevel,
    companyIndustry: job.companyIndustry,
    employer: job.employer_id
      ? {
          id: job.employer_id._id,
          name: job.employer_id.company_name,
          website: job.employer_id.company_website,
        }
      : null,
    expected_salary: job.expected_salary,
    expected_salary_currency: job.expected_salary_currency,
    salaryType: job.salaryType,
    skills: job.skills,
    posted_at: job.posted_at,
    applicationDeadline: job.applicationDeadline,
  };
}

/**
 * List jobs with in-memory filtering + pagination, since kazini_backend
 * provides neither.
 */
export async function listJobs({
  page = 1,
  pageSize = 20,
  location,
  jobType,
  experienceLevel,
  contractType,
  skill,
  search,
} = {}) {
  const all = await fetchAllJobs();
  let filtered = all.filter((j) => j.is_active !== false);

  if (location) {
    const q = location.toLowerCase();
    filtered = filtered.filter((j) => j.location?.toLowerCase().includes(q));
  }
  if (jobType) {
    filtered = filtered.filter((j) => j.jobType === jobType);
  }
  if (experienceLevel) {
    filtered = filtered.filter((j) => j.experienceLevel === experienceLevel);
  }
  if (contractType) {
    filtered = filtered.filter((j) => j.contract_type === contractType);
  }
  if (skill) {
    const q = skill.toLowerCase();
    filtered = filtered.filter((j) => Array.isArray(j.skills) && j.skills.some((s) => s.toLowerCase().includes(q)));
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (j) => j.title?.toLowerCase().includes(q) || j.companyIndustry?.toLowerCase().includes(q)
    );
  }

  filtered = [...filtered].sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return { data: pageItems.map(summarizeJob), total };
}

export async function getJob(jobId) {
  const all = await fetchAllJobs();
  const job = all.find((j) => String(j._id) === String(jobId));
  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }

  return {
    id: job._id,
    title: job.title,
    location: job.location,
    jobType: job.jobType,
    contract_type: job.contract_type,
    aboutJob: job.aboutJob,
    responsibilities: job.responsibilities,
    qualifications: job.qualifications,
    benefits: job.benefits,
    skills: job.skills,
    experienceLevel: job.experienceLevel,
    educationLevel: job.educationLevel,
    companyIndustry: job.companyIndustry,
    employer: job.employer_id
      ? {
          id: job.employer_id._id,
          name: job.employer_id.company_name,
          website: job.employer_id.company_website,
        }
      : null,
    expected_salary: job.expected_salary,
    expected_salary_currency: job.expected_salary_currency,
    requireCoverLetter: Boolean(job.requireCoverLetter),
    requiredDocuments: job.requiredDocuments || [],
    customQuestions: job.customQuestions || [],
    applicationDeadline: job.applicationDeadline,
    rollingBasis: Boolean(job.rollingBasis),
    posted_at: job.posted_at,
  };
}

/**
 * Submit an application to kazini_backend server-to-server. Its /applications
 * route requires no auth from this side, but does strict field validation
 * (see kazini_backend/controllers/Application.controller.js) — payload shape
 * must match exactly (resume must be an https URL ending in .pdf, customAnswers
 * must match job.customQuestions 1:1, etc).
 */
export async function submitApplication(payload) {
  const res = await fetch(`${baseUrl()}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));

  if (res.status === 409) {
    // Already applied with this email for this job — treat as a soft conflict.
    const err = new Error(body.message || 'You have already applied for this position');
    err.statusCode = 409;
    err.kaziniApplicationId = body.applicationId;
    throw err;
  }
  if (!res.ok) {
    logger.warn(`kazini_backend application submission failed: ${res.status} ${JSON.stringify(body)}`);
    const err = new Error(body.message || 'Application submission failed');
    err.statusCode = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }

  return body; // { message, applicationId }
}
