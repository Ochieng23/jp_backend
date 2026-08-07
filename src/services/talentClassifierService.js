import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { INDUSTRIES } from '../constants/industries.js';
import { SENIORITY_LEVELS, INDUSTRY_DEFINITIONS } from '../constants/talentClassification.js';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not configured');
    err.statusCode = 501;
    throw err;
  }
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  return client;
}

const MODEL = process.env.TALENT_CLASSIFIER_MODEL || 'claude-haiku-4-5';
const MAX_AGENT_TURNS = 4;

const LOOKUP_TOOL = {
  name: 'lookup_industry_definitions',
  description:
    "Returns a one-line definition of every industry in the platform's controlled taxonomy. Call this if a holder's work history or credentials don't obviously map to one of the industry names — e.g. to tell apart adjacent industries like Insurance vs Financial Services & Banking, or Mining & Extractives vs Oil & Gas.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

const SUBMIT_TOOL = {
  name: 'submit_classification',
  description: "Report your final classification of this holder's talent profile. Call this exactly once, when you're done reasoning.",
  input_schema: {
    type: 'object',
    properties: {
      primary_industry: { type: 'string', enum: INDUSTRIES, description: 'The single industry this person is most identified with.' },
      secondary_industries: {
        type: 'array',
        items: { type: 'string', enum: INDUSTRIES },
        maxItems: 3,
        description: 'Up to 3 other industries this person has real experience in. Do not repeat primary_industry.',
      },
      expertise_areas: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 6,
        description:
          'Specific functional/skill tags within their industry, e.g. "Backend Engineering", "Clinical Nursing", "Tax Accounting", "Fleet Logistics". Short (2-4 words), title case, no industry name repeated inside the tag.',
      },
      seniority_level: {
        type: 'string',
        enum: SENIORITY_LEVELS,
        description:
          'entry = 0-2 years or first role; mid = 2-6 years, independent contributor; senior = 6+ years or clear subject-matter depth; lead = manages people/projects or is the senior-most specialist on a team; executive = C-suite/director/head-of level.',
      },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Your confidence in this classification, 0-1.' },
      summary: { type: 'string', maxLength: 300, description: '1-2 sentence plain-English rationale an admin can read at a glance.' },
      evidence: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['education', 'work_experience', 'credential', 'profile'] },
            id: { type: 'string', description: 'The _id of the specific education/work_experience/credential record, or "profile" for bio/self-reported industries.' },
            note: { type: 'string', maxLength: 140, description: 'Why this record supports the classification.' },
          },
          required: ['source', 'id', 'note'],
        },
        description:
          'Which specific records this classification is grounded in. Mandatory — cite the [id:...] of every education/work_experience/credential entry that actually drove your call. If the holder has zero records of any kind, cite one entry with source:profile, id:profile.',
      },
    },
    required: ['primary_industry', 'expertise_areas', 'seniority_level', 'confidence', 'summary', 'evidence'],
    additionalProperties: false,
  },
};

/** Renders a holder's raw profile + entries into the plain-text brief the
 * classifier reasons over. Every record's real _id is included so the model
 * can cite it back in `evidence` — that citation is what lets an admin
 * verify the AI's call against the actual source record instead of trusting
 * a black box. */
function buildBrief(holder, { education, workExperience, credentials }) {
  const lines = [];
  lines.push(`Full name: ${holder.full_name}`);
  if (holder.bio) lines.push(`Bio: ${holder.bio}`);
  if (holder.industries?.length) lines.push(`Self-reported industries: ${holder.industries.join(', ')}`);
  if (holder.nationality) lines.push(`Nationality: ${holder.nationality}`);

  lines.push('\n## Work Experience');
  if (!workExperience.length) lines.push('(none on file)');
  for (const w of workExperience) {
    const end = w.is_current ? 'present' : w.end_date ? new Date(w.end_date).toISOString().slice(0, 7) : 'unknown end';
    lines.push(
      `- [id:${w._id}] ${w.job_title} at ${w.employer_name} (${new Date(w.start_date).toISOString().slice(0, 7)} to ${end}, ${w.verified ? 'verified' : 'unverified'})${w.description ? ` — ${w.description}` : ''}`
    );
  }

  lines.push('\n## Education');
  if (!education.length) lines.push('(none on file)');
  for (const e of education) {
    lines.push(
      `- [id:${e._id}] ${e.qualification} at ${e.institution_name} (${e.verified ? 'verified' : 'unverified'})`
    );
  }

  lines.push('\n## Credentials');
  if (!credentials.length) lines.push('(none on file)');
  for (const c of credentials) {
    lines.push(
      `- [id:${c._id}] ${c.title} (${c.type}, issued by ${c.issuer_name || 'unknown issuer'}, ${c.verified ? 'verified' : 'unverified'})${c.description ? ` — ${c.description}` : ''}`
    );
  }

  return lines.join('\n');
}

/** Deterministic, not LLM-derived: sums the duration of each work-experience
 * entry (overlapping ranges counted once). Arithmetic like this shouldn't be
 * delegated to a model. */
export function computeYearsOfExperience(workExperience) {
  const ranges = workExperience
    .map((w) => [new Date(w.start_date).getTime(), w.is_current || !w.end_date ? Date.now() : new Date(w.end_date).getTime()])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);

  let totalMs = 0;
  let [curStart, curEnd] = ranges[0] || [0, 0];
  for (const [start, end] of ranges.slice(1)) {
    if (start > curEnd) {
      totalMs += curEnd - curStart;
      [curStart, curEnd] = [start, end];
    } else {
      curEnd = Math.max(curEnd, end);
    }
  }
  totalMs += curEnd - curStart;

  return Math.round((totalMs / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
}

const SYSTEM_PROMPT = `You are a talent-classification agent for Cazini, a job passport platform serving jobseekers across Africa. Given one holder's profile, work history, education, and credentials, classify them for an admin building a searchable talent pool.

Ground every claim in the actual records provided — do not invent employers, dates, or skills. If the profile is too thin to classify confidently (e.g. no work history and no credentials), still make your best call but reflect that in a low confidence score and say so in the summary.

You must always cite evidence: every education/work_experience/credential entry that shaped your call, referenced by its [id:...]. This is non-negotiable — an admin needs to verify your reasoning against real records, not trust a bare label. Only skip real citations (using source:profile, id:profile instead) when the holder genuinely has zero education, work history, or credential entries.

You have two tools available. Use lookup_industry_definitions if you're unsure which industry a role belongs to. When you've decided, call submit_classification exactly once with your final answer — that ends the task.`;

/**
 * Runs the classification agent loop for one holder. Returns the validated
 * classification object (matching PassportHolder.talent_classification),
 * or throws if the agent never calls submit_classification within the turn
 * budget.
 */
export async function classifyHolder(holder, { education, workExperience, credentials }) {
  const anthropic = getClient();
  const brief = buildBrief(holder, { education, workExperience, credentials });

  const messages = [{ role: 'user', content: `Classify this holder:\n\n${brief}` }];
  let evidenceCorrectionSent = false;

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [LOOKUP_TOOL, SUBMIT_TOOL],
      tool_choice: turn === MAX_AGENT_TURNS - 1 ? { type: 'tool', name: 'submit_classification' } : { type: 'auto' },
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolCalls = response.content.filter((b) => b.type === 'tool_use');
    if (!toolCalls.length) {
      // Model stopped without calling a tool (e.g. hit its own text-only
      // response) — nudge it back toward finishing the job.
      messages.push({ role: 'user', content: 'Please call submit_classification with your final answer.' });
      continue;
    }

    const submitCall = toolCalls.find((b) => b.name === 'submit_classification');
    const hasRecords = education.length + workExperience.length + credentials.length > 0;
    const rejectEvidence = submitCall && hasRecords && !(submitCall.input.evidence || []).length && !evidenceCorrectionSent;

    if (submitCall && !rejectEvidence) {
      logger.info(`Classified holder ${holder._id} as ${submitCall.input.primary_industry}/${submitCall.input.seniority_level} in ${turn + 1} turn(s)`);
      return normalizeClassification(submitCall.input, workExperience);
    }

    // Every tool_use in this turn needs a matching tool_result before the
    // next request, whether or not submit_classification is the one being
    // rejected — the API errors if any call is left unanswered.
    if (rejectEvidence) evidenceCorrectionSent = true;
    const toolResults = toolCalls.map((call) => {
      if (call.name === 'lookup_industry_definitions') {
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(INDUSTRY_DEFINITIONS) };
      }
      if (call.name === 'submit_classification' && rejectEvidence) {
        return { type: 'tool_result', tool_use_id: call.id, content: 'Rejected: evidence was empty.', is_error: true };
      }
      return { type: 'tool_result', tool_use_id: call.id, content: 'Unknown tool', is_error: true };
    });
    if (rejectEvidence) {
      toolResults.push({
        type: 'text',
        text: `You submitted a classification with no evidence, but this holder has ${education.length} education, ${workExperience.length} work experience, and ${credentials.length} credential record(s) on file. Call submit_classification again, citing the [id:...] of at least one record you actually relied on.`,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Classifier agent did not produce a classification within the turn budget');
}

/** Truncates at the last whole word within the limit, appending an ellipsis,
 * instead of cutting mid-word — this renders in an admin-facing card. */
function truncateAtWord(text, maxLength) {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

function normalizeClassification(input, workExperience) {
  const industrySet = new Set(INDUSTRIES);
  const primary_industry = industrySet.has(input.primary_industry) ? input.primary_industry : 'Other';
  const secondary_industries = (input.secondary_industries || [])
    .filter((i) => industrySet.has(i) && i !== primary_industry)
    .slice(0, 3);
  const seniority_level = SENIORITY_LEVELS.includes(input.seniority_level) ? input.seniority_level : 'mid';
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0));

  return {
    primary_industry,
    secondary_industries,
    expertise_areas: (input.expertise_areas || []).filter(Boolean).slice(0, 6),
    seniority_level,
    years_of_experience: computeYearsOfExperience(workExperience),
    confidence,
    summary: truncateAtWord(String(input.summary || ''), 300),
    evidence: (input.evidence || []).slice(0, 8).map((e) => ({
      source: e.source,
      id: e.id,
      note: truncateAtWord(String(e.note || ''), 140),
    })),
    model: MODEL,
    classified_at: new Date(),
  };
}
