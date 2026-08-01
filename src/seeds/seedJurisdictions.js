// One-off/idempotent seed: populates the Jurisdiction collection with a
// full set of ISO 3166-1 alpha-3 country codes so the jurisdiction picker
// has real countries to search, not just the handful used in demo data.
// Safe to re-run — upserts by country_code, never overwrites recognition_rules.
import 'dotenv/config';
import mongoose from 'mongoose';
import Jurisdiction from '../models/Jurisdiction.js';
import { COUNTRIES } from './countryList.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  let created = 0;
  let skipped = 0;

  for (const { code, name } of COUNTRIES) {
    const res = await Jurisdiction.updateOne(
      { country_code: code },
      { $setOnInsert: { country_code: code, country_name: name, recognition_rules: {} } },
      { upsert: true }
    );
    if (res.upsertedCount > 0) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`Jurisdictions seeded: ${created} created, ${skipped} already existed.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Jurisdiction seed failed:', err);
  process.exit(1);
});
