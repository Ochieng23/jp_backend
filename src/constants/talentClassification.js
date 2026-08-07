export const SENIORITY_LEVELS = ['entry', 'mid', 'senior', 'lead', 'executive'];

// One short line per industry to help the classifier disambiguate niche or
// ambiguous job titles (e.g. "Debt Collection Field Agent" -> Financial
// Services & Banking, not Security Services) — surfaced to the model via the
// lookup_industry_definitions tool rather than stuffed into every prompt.
export const INDUSTRY_DEFINITIONS = {
  'Agriculture & Agribusiness': 'Farming, livestock, agri-processing, agri-inputs, forestry, fisheries.',
  Aviation: 'Airlines, airports, ground handling, aircraft maintenance, air cargo.',
  'Construction & Real Estate': 'Building construction, civil engineering, property development, facilities/estate management.',
  'Education & Training': 'Schools, universities, vocational training, tutoring, curriculum/edtech.',
  'Energy & Utilities': 'Electricity generation/distribution, renewables, water/power utilities (not oil & gas extraction).',
  'Financial Services & Banking': 'Banks, microfinance, payments, lending/collections, fintech, investment/wealth management.',
  'Government & Public Sector': 'Civil service, ministries, parastatals, public administration, diplomacy.',
  'Healthcare & Medical': 'Hospitals, clinics, nursing, pharmacy, medical labs, public health.',
  'Hospitality & Tourism': 'Hotels, restaurants, travel agencies, tour operators, events.',
  'Information Technology & Software': 'Software engineering, IT infrastructure/support, data, product, cybersecurity.',
  Insurance: 'Underwriting, claims, actuarial, insurance brokerage (distinct from banking).',
  'Legal Services': 'Law firms, in-house legal, compliance, paralegal, notarial services.',
  'Logistics & Transportation': 'Freight, shipping, courier, warehousing, supply chain, public/private transport operators.',
  'Manufacturing & Industrial': 'Factory production, industrial engineering, quality control, plant operations.',
  'Media, Communications & Entertainment': 'Journalism, broadcasting, marketing/advertising, PR, film/music/creative content.',
  'Mining & Extractives': 'Mineral mining, quarrying, extractive-sector engineering (not oil & gas).',
  'NGO & Nonprofit': 'International/local NGOs, humanitarian, development, advocacy organisations.',
  'Oil & Gas': 'Upstream/downstream petroleum, refining, oilfield services.',
  'Professional & Business Services': 'Consulting, accounting/audit, HR services, business process outsourcing — general "office professional" roles that don’t fit a more specific industry.',
  'Retail & E-commerce': 'Physical/online retail, sales floor, merchandising, e-commerce operations.',
  'Security Services': 'Private security, guarding, surveillance, risk/investigations (not police/military, which fall under Government).',
  Telecommunications: 'Mobile/fixed network operators, telecom infrastructure, ISPs.',
  'Textiles & Apparel': 'Garment manufacturing, textile production, fashion.',
  'Water & Sanitation': 'Water treatment/supply, sanitation, WASH programmes.',
  Other: 'Use only when no other industry reasonably applies.',
};
