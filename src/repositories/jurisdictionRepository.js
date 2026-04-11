import Jurisdiction from '../models/Jurisdiction.js';

/**
 * Create a new jurisdiction record.
 * @param {object} data - { country_code, country_name, recognition_rules? }
 * @returns {Promise<object>}
 */
export async function createJurisdiction(data) {
  const jurisdiction = await Jurisdiction.create(data);
  return jurisdiction.toObject();
}

/**
 * Return all jurisdictions ordered alphabetically by country name.
 * @returns {Promise<object[]>}
 */
export async function findAll() {
  return Jurisdiction.find().sort({ country_name: 1 }).lean();
}

/**
 * Find a jurisdiction by its MongoDB _id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findById(id) {
  return Jurisdiction.findById(id).lean();
}

/**
 * Find a jurisdiction by its ISO 3-letter country code.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function findByCountryCode(code) {
  return Jurisdiction.findOne({ country_code: code.toUpperCase() }).lean();
}

/**
 * Update a jurisdiction's country_name and/or recognition_rules.
 * @param {string} id
 * @param {object} data
 * @returns {Promise<object|null>}
 */
export async function updateJurisdiction(id, data) {
  const allowed = {};
  for (const f of ['country_code', 'country_name', 'recognition_rules']) {
    if (data[f] !== undefined) allowed[f] = data[f];
  }
  return Jurisdiction.findByIdAndUpdate(id, allowed, {
    new: true,
    runValidators: true,
  }).lean();
}
