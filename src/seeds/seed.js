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

// ─── Certificate document helpers ─────────────────────────────────────────────
function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const CERT_SECONDARY = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="562" viewBox="0 0 794 562" font-family="Georgia,serif">
  <rect width="794" height="562" fill="#fdfaf4"/>
  <rect x="18" y="18" width="758" height="526" fill="none" stroke="#1e3a8a" stroke-width="3"/>
  <rect x="26" y="26" width="742" height="510" fill="none" stroke="#1e3a8a" stroke-width="1" stroke-dasharray="4,4"/>
  <rect x="18" y="18" width="758" height="60" fill="#1e3a8a"/>
  <text x="397" y="44" text-anchor="middle" fill="#fff" font-size="11" letter-spacing="3" font-weight="bold">RÉPUBLIQUE DÉMOCRATIQUE DU CONGO</text>
  <text x="397" y="62" text-anchor="middle" fill="#93c5fd" font-size="9.5" letter-spacing="1">Ministère de l'Éducation Primaire, Secondaire et Professionnelle</text>
  <circle cx="397" cy="115" r="36" fill="none" stroke="#1e3a8a" stroke-width="2"/>
  <circle cx="397" cy="115" r="28" fill="#eff6ff"/>
  <text x="397" y="109" text-anchor="middle" fill="#1e3a8a" font-size="7.5" font-weight="bold">LYCÉE</text>
  <text x="397" y="120" text-anchor="middle" fill="#1e3a8a" font-size="7.5" font-weight="bold">BOMOKO</text>
  <text x="397" y="131" text-anchor="middle" fill="#1e3a8a" font-size="6.5">KINSHASA</text>
  <text x="397" y="170" text-anchor="middle" fill="#1e3a8a" font-size="18" font-weight="bold" letter-spacing="1">ATTESTATION DE RÉUSSITE</text>
  <text x="397" y="190" text-anchor="middle" fill="#374151" font-size="10.5">Certificat d'Études Secondaires du Cycle Complet — Humanités Scientifiques</text>
  <line x1="80" y1="200" x2="714" y2="200" stroke="#cbd5e1" stroke-width="1"/>
  <text x="397" y="228" text-anchor="middle" fill="#374151" font-size="12">Le Directeur de l'établissement soussigné certifie que l'élève</text>
  <text x="397" y="265" text-anchor="middle" fill="#111827" font-size="26" font-weight="bold" font-style="italic">Mushimiyimana Synthia</text>
  <text x="397" y="288" text-anchor="middle" fill="#374151" font-size="11">née le 09 juillet 2007 à Kinshasa, Province de Kinshasa</text>
  <text x="397" y="313" text-anchor="middle" fill="#374151" font-size="11.5">a satisfait aux épreuves nationales de fin de cycle secondaire organisées par</text>
  <text x="397" y="330" text-anchor="middle" fill="#374151" font-size="11.5">l'Office National de l'Enseignement Secondaire (ONES) et obtenu la note de</text>
  <rect x="287" y="343" width="224" height="36" rx="4" fill="#dbeafe"/>
  <text x="397" y="366" text-anchor="middle" fill="#1e3a8a" font-size="17" font-weight="bold">DISTINCTION — 84 %</text>
  <text x="397" y="405" text-anchor="middle" fill="#374151" font-size="11">lui conférant le droit de poursuivre des études supérieures.</text>
  <text x="397" y="427" text-anchor="middle" fill="#374151" font-size="10.5">Délivré à Kinshasa, le 15 juillet 2024 · Réf. MEPSP/LBK/2024/07142</text>
  <line x1="90" y1="480" x2="270" y2="480" stroke="#374151" stroke-width="1"/>
  <text x="180" y="493" text-anchor="middle" fill="#374151" font-size="9.5">Le Directeur</text>
  <text x="180" y="505" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">Prof. Jean-Claude Mbeki</text>
  <circle cx="397" cy="478" r="28" fill="none" stroke="#1e3a8a" stroke-width="1.5" opacity="0.4"/>
  <text x="397" y="474" text-anchor="middle" fill="#1e3a8a" font-size="6" opacity="0.5">SCEAU OFFICIEL</text>
  <text x="397" y="484" text-anchor="middle" fill="#1e3a8a" font-size="5.5" opacity="0.5">LYCÉE BOMOKO</text>
  <line x1="524" y1="480" x2="704" y2="480" stroke="#374151" stroke-width="1"/>
  <text x="614" y="493" text-anchor="middle" fill="#374151" font-size="9.5">Inspecteur Provincial EPST</text>
  <text x="614" y="505" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">M. Antoine Luzolo</text>
  <text x="397" y="535" text-anchor="middle" fill="#9ca3af" font-size="8">Ce document est délivré conformément aux dispositions légales en vigueur en RDC — MEPSP/2024</text>
</svg>`);

const CERT_DELF = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="562" viewBox="0 0 794 562" font-family="Arial,sans-serif">
  <rect width="794" height="562" fill="#fff"/>
  <rect x="0" y="0" width="794" height="8" fill="#002395"/>
  <rect x="0" y="8" width="794" height="8" fill="#fff"/>
  <rect x="0" y="16" width="794" height="8" fill="#ED2939"/>
  <rect x="18" y="32" width="758" height="514" fill="none" stroke="#d1d5db" stroke-width="1"/>
  <rect x="18" y="32" width="758" height="80" fill="#f8f9ff"/>
  <text x="397" y="68" text-anchor="middle" fill="#002395" font-size="22" font-weight="bold" letter-spacing="4">ALLIANCE FRANÇAISE</text>
  <text x="397" y="87" text-anchor="middle" fill="#374151" font-size="10" letter-spacing="2">DE KINSHASA — DÉLÉGATION GÉNÉRALE</text>
  <text x="100" y="140" fill="#002395" font-size="13" font-weight="bold">DIPLÔME D'ÉTUDES EN LANGUE FRANÇAISE</text>
  <text x="100" y="158" fill="#374151" font-size="11">Accrédité par le Ministère français de l'Éducation Nationale</text>
  <line x1="60" y1="168" x2="734" y2="168" stroke="#e5e7eb" stroke-width="1"/>
  <rect x="60" y="180" width="90" height="90" rx="8" fill="#002395"/>
  <text x="105" y="222" text-anchor="middle" fill="#fff" font-size="32" font-weight="bold">B1</text>
  <text x="105" y="244" text-anchor="middle" fill="#93c5fd" font-size="9">UTILISATEUR</text>
  <text x="105" y="256" text-anchor="middle" fill="#93c5fd" font-size="9">INDÉPENDANT</text>
  <text x="170" y="205" fill="#111827" font-size="20" font-weight="bold" font-style="italic">Mushimiyimana Synthia</text>
  <text x="170" y="224" fill="#374151" font-size="11">née le 09 juillet 2007 — Nationalité congolaise</text>
  <text x="170" y="244" fill="#374151" font-size="11">a obtenu le niveau B1 du Cadre Européen Commun de Référence</text>
  <text x="170" y="260" fill="#374151" font-size="11">pour les Langues (CECRL) avec un score de</text>
  <text x="170" y="282" fill="#002395" font-size="20" font-weight="bold">72,5 / 100</text>
  <line x1="60" y1="300" x2="734" y2="300" stroke="#e5e7eb" stroke-width="1"/>
  <text x="80" y="328" fill="#374151" font-size="11" font-weight="bold">Détail des épreuves :</text>
  <text x="80" y="350" fill="#374151" font-size="10.5">Compréhension de l'oral</text><text x="380" y="350" fill="#002395" font-size="10.5" font-weight="bold">17,5 / 25</text>
  <text x="80" y="368" fill="#374151" font-size="10.5">Compréhension des écrits</text><text x="380" y="368" fill="#002395" font-size="10.5" font-weight="bold">18,5 / 25</text>
  <text x="80" y="386" fill="#374151" font-size="10.5">Production écrite</text><text x="380" y="386" fill="#002395" font-size="10.5" font-weight="bold">18,0 / 25</text>
  <text x="80" y="404" fill="#374151" font-size="10.5">Production orale</text><text x="380" y="404" fill="#002395" font-size="10.5" font-weight="bold">18,5 / 25</text>
  <rect x="60" y="416" width="320" height="2" fill="#002395" opacity="0.2"/>
  <text x="80" y="432" fill="#374151" font-size="10" font-weight="bold">Total : 72,5 / 100 — Mention : Bien</text>
  <line x1="60" y1="450" x2="734" y2="450" stroke="#e5e7eb" stroke-width="1"/>
  <text x="397" y="468" text-anchor="middle" fill="#374151" font-size="10.5">Kinshasa, le 20 mars 2024 · N° de certificat : DELF-KIN-2024-B1-04712</text>
  <line x1="90" y1="500" x2="290" y2="500" stroke="#374151" stroke-width="1"/>
  <text x="190" y="513" text-anchor="middle" fill="#374151" font-size="9.5">Directrice — Alliance Française Kinshasa</text>
  <text x="190" y="526" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">Mme Sophie Beaumont</text>
  <circle cx="530" cy="490" r="30" fill="none" stroke="#002395" stroke-width="1.5" opacity="0.35"/>
  <text x="530" y="487" text-anchor="middle" fill="#002395" font-size="6" opacity="0.4">ALLIANCE</text>
  <text x="530" y="497" text-anchor="middle" fill="#002395" font-size="6" opacity="0.4">FRANÇAISE</text>
  <line x1="590" y1="500" x2="720" y2="500" stroke="#374151" stroke-width="1"/>
  <text x="655" y="513" text-anchor="middle" fill="#374151" font-size="9.5">Coordinateur DELF/DALF</text>
  <text x="655" y="526" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">M. Pierre-Yves Renard</text>
  <text x="397" y="548" text-anchor="middle" fill="#9ca3af" font-size="7.5">Ce diplôme est délivré en vertu de la convention entre le CIEP et l'Alliance Française de Kinshasa. Il est valide à vie.</text>
</svg>`);

const CERT_DIPLOMA_ENROLL = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="562" viewBox="0 0 794 562" font-family="Arial,sans-serif">
  <rect width="794" height="562" fill="#fff"/>
  <rect x="0" y="0" width="794" height="6" fill="#1e3a8a"/>
  <rect x="18" y="22" width="758" height="524" fill="none" stroke="#e5e7eb" stroke-width="1"/>
  <rect x="18" y="22" width="758" height="75" fill="#f0f4ff"/>
  <text x="397" y="52" text-anchor="middle" fill="#1e3a8a" font-size="16" font-weight="bold" letter-spacing="1">INSTITUT SUPÉRIEUR DE COMMERCE DE KINSHASA</text>
  <text x="397" y="69" text-anchor="middle" fill="#374151" font-size="9.5" letter-spacing="1">ISC-KINSHASA · Agréé par le Ministère de l'Enseignement Supérieur et Universitaire · www.isc-kinshasa.cd</text>
  <text x="80" y="135" fill="#1e3a8a" font-size="14" font-weight="bold">ATTESTATION D'INSCRIPTION ET DE FRÉQUENTATION</text>
  <line x1="60" y1="145" x2="734" y2="145" stroke="#e5e7eb" stroke-width="1"/>
  <text x="80" y="175" fill="#374151" font-size="11">Kinshasa, le 1er février 2025</text>
  <text x="80" y="210" fill="#374151" font-size="11.5">Le Secrétaire Académique de l'Institut Supérieur de Commerce de Kinshasa,</text>
  <text x="80" y="228" fill="#374151" font-size="11.5">soussigné, atteste par la présente que :</text>
  <text x="397" y="268" text-anchor="middle" fill="#111827" font-size="21" font-weight="bold" font-style="italic">Mushimiyimana Synthia</text>
  <text x="397" y="287" text-anchor="middle" fill="#374151" font-size="10.5">née le 09 juillet 2007 — Matricule étudiant : ISC/G1/2024-25/04821</text>
  <text x="80" y="320" fill="#374151" font-size="11.5">est régulièrement inscrite et fréquente les cours de</text>
  <rect x="140" y="332" width="514" height="38" rx="4" fill="#eff6ff"/>
  <text x="397" y="348" text-anchor="middle" fill="#1e3a8a" font-size="13" font-weight="bold">Diplôme de Graduat en Sciences de Gestion</text>
  <text x="397" y="363" text-anchor="middle" fill="#1e3a8a" font-size="10.5">Option : Administration des Affaires — Première Année (G1)</text>
  <text x="80" y="398" fill="#374151" font-size="11.5">pour l'année académique 2024–2025. Elle est en règle avec l'administration</text>
  <text x="80" y="416" fill="#374151" font-size="11.5">académique et a satisfait aux conditions d'admission.</text>
  <text x="80" y="440" fill="#374151" font-size="11">La présente attestation est délivrée à la demande de l'intéressée pour servir</text>
  <text x="80" y="457" fill="#374151" font-size="11">et valoir ce que de droit.</text>
  <line x1="60" y1="478" x2="734" y2="478" stroke="#e5e7eb" stroke-width="1"/>
  <text x="397" y="494" text-anchor="middle" fill="#374151" font-size="10">Fait à Kinshasa, le 1er février 2025 · Réf. ISC/SA/2024-25/0482</text>
  <line x1="500" y1="520" x2="700" y2="520" stroke="#374151" stroke-width="1"/>
  <text x="600" y="533" text-anchor="middle" fill="#374151" font-size="9.5">Le Secrétaire Académique</text>
  <text x="600" y="545" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">M. Désiré Nkumu, PhD</text>
  <circle cx="200" cy="515" r="30" fill="none" stroke="#1e3a8a" stroke-width="1.5" opacity="0.35"/>
  <text x="200" y="511" text-anchor="middle" fill="#1e3a8a" font-size="6" opacity="0.4">ISC</text>
  <text x="200" y="521" text-anchor="middle" fill="#1e3a8a" font-size="6" opacity="0.4">KINSHASA</text>
  <text x="397" y="556" text-anchor="middle" fill="#9ca3af" font-size="7.5">Document officiel — ISC-Kinshasa — Toute falsification est passible de poursuites judiciaires.</text>
</svg>`);

// Work experience reference letters
const REF_SHOPRITE = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="562" viewBox="0 0 794 562" font-family="Arial,sans-serif">
  <rect width="794" height="562" fill="#fff"/>
  <rect x="0" y="0" width="794" height="6" fill="#e41e1e"/>
  <rect x="18" y="22" width="758" height="524" fill="none" stroke="#e5e7eb" stroke-width="1"/>
  <rect x="18" y="22" width="758" height="75" fill="#fff5f5"/>
  <text x="397" y="52" text-anchor="middle" fill="#e41e1e" font-size="20" font-weight="bold" letter-spacing="2">SHOPRITE HOLDINGS</text>
  <text x="397" y="69" text-anchor="middle" fill="#374151" font-size="9.5">Shoprite Kinshasa Limete · 147 Boulevard du 30 Juin, Limete, Kinshasa-DRC</text>
  <text x="80" y="135" fill="#111827" font-size="14" font-weight="bold">EMPLOYMENT REFERENCE LETTER</text>
  <line x1="60" y1="145" x2="734" y2="145" stroke="#e5e7eb" stroke-width="1"/>
  <text x="80" y="178" fill="#374151" font-size="11">Kinshasa, 15 February 2024</text>
  <text x="80" y="210" fill="#374151" font-size="11.5">To Whom It May Concern,</text>
  <text x="80" y="240" fill="#374151" font-size="11">This letter confirms that</text>
  <text x="80" y="268" fill="#111827" font-size="19" font-weight="bold" font-style="italic">Mushimiyimana Synthia</text>
  <text x="80" y="296" fill="#374151" font-size="11">was employed at Shoprite Kinshasa — Limete Branch as a</text>
  <text x="80" y="314" fill="#374151" font-size="11" font-weight="bold">Cashier and Customer Service Representative</text>
  <text x="80" y="338" fill="#374151" font-size="11">from 1 June 2023 to 31 January 2024 (8 months).</text>
  <text x="80" y="368" fill="#374151" font-size="11">During her tenure, Synthia demonstrated exceptional diligence and professionalism. She</text>
  <text x="80" y="386" fill="#374151" font-size="11">maintained zero discrepancy in daily cash reconciliation over 8 months and was awarded</text>
  <text x="80" y="404" fill="#374151" font-size="11">"Employee of the Month" in October 2023. We recommend her without reservation.</text>
  <text x="80" y="438" fill="#374151" font-size="11">She left the role voluntarily to pursue further education. She is eligible for rehire.</text>
  <line x1="60" y1="470" x2="734" y2="470" stroke="#e5e7eb" stroke-width="1"/>
  <text x="397" y="486" text-anchor="middle" fill="#374151" font-size="10">Ref: SHR/HR/KIN/2024/0218 · hr.kinshasa@shoprite-drc.com</text>
  <line x1="480" y1="516" x2="700" y2="516" stroke="#374151" stroke-width="1"/>
  <text x="590" y="529" text-anchor="middle" fill="#374151" font-size="9.5">Human Resources Manager</text>
  <text x="590" y="542" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">Mr. Emmanuel Kabila</text>
  <text x="397" y="555" text-anchor="middle" fill="#9ca3af" font-size="7.5">Shoprite Holdings Ltd. — Registered in South Africa. This document is official and may be verified by contacting our HR department.</text>
</svg>`);

const REF_UNHCR = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="562" viewBox="0 0 794 562" font-family="Arial,sans-serif">
  <rect width="794" height="562" fill="#fff"/>
  <rect x="0" y="0" width="794" height="6" fill="#009EDB"/>
  <rect x="18" y="22" width="758" height="524" fill="none" stroke="#e5e7eb" stroke-width="1"/>
  <rect x="18" y="22" width="758" height="75" fill="#f0f9ff"/>
  <text x="397" y="48" text-anchor="middle" fill="#009EDB" font-size="16" font-weight="bold" letter-spacing="2">UNHCR — THE UN REFUGEE AGENCY</text>
  <text x="397" y="65" text-anchor="middle" fill="#374151" font-size="9.5">Livelihood Programme DRC · BP 7248, Goma, North Kivu, Democratic Republic of Congo</text>
  <text x="80" y="130" fill="#111827" font-size="14" font-weight="bold">VOLUNTEER SERVICE CERTIFICATE</text>
  <line x1="60" y1="142" x2="734" y2="142" stroke="#e5e7eb" stroke-width="1"/>
  <text x="80" y="173" fill="#374151" font-size="11">Goma, 5 June 2023</text>
  <text x="80" y="205" fill="#374151" font-size="11.5">UNHCR Livelihood Programme DRC hereby certifies that</text>
  <text x="80" y="238" fill="#111827" font-size="20" font-weight="bold" font-style="italic">Mushimiyimana Synthia</text>
  <text x="80" y="265" fill="#374151" font-size="11">served as a Community Outreach Volunteer with our programme from</text>
  <text x="80" y="283" fill="#374151" font-size="11" font-weight="bold">1 September 2022 to 30 May 2023 (9 months)</text>
  <text x="80" y="313" fill="#374151" font-size="11">operating across refugee settlements in North Kivu province. Her responsibilities included</text>
  <text x="80" y="331" fill="#374151" font-size="11">household needs assessments, community meeting facilitation (Swahili/Kinyarwanda), and</text>
  <text x="80" y="349" fill="#374151" font-size="11">documentation of over 400 family profiles for targeted humanitarian assistance.</text>
  <text x="80" y="379" fill="#374151" font-size="11">Her work was of outstanding quality and contributed directly to programme outcomes. We</text>
  <text x="80" y="397" fill="#374151" font-size="11">highly recommend her for future employment or educational opportunities.</text>
  <line x1="60" y1="430" x2="734" y2="430" stroke="#e5e7eb" stroke-width="1"/>
  <text x="397" y="446" text-anchor="middle" fill="#374151" font-size="10">UNHCR/DRC/LIV/2023/VOL-4218 · livelihoods.drc@unhcr.org</text>
  <line x1="90" y1="496" x2="310" y2="496" stroke="#374151" stroke-width="1"/>
  <text x="200" y="509" text-anchor="middle" fill="#374151" font-size="9.5">Programme Officer — Livelihoods</text>
  <text x="200" y="522" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">Ms. Amina Warsame</text>
  <circle cx="397" cy="480" r="28" fill="none" stroke="#009EDB" stroke-width="1.5" opacity="0.35"/>
  <text x="397" y="477" text-anchor="middle" fill="#009EDB" font-size="6" opacity="0.4">UNHCR DRC</text>
  <text x="397" y="487" text-anchor="middle" fill="#009EDB" font-size="5.5" opacity="0.4">OFFICIAL SEAL</text>
  <line x1="490" y1="496" x2="700" y2="496" stroke="#374151" stroke-width="1"/>
  <text x="595" y="509" text-anchor="middle" fill="#374151" font-size="9.5">Field Representative, North Kivu</text>
  <text x="595" y="522" text-anchor="middle" fill="#6b7280" font-size="9" font-style="italic">Mr. Didier Hakizimana</text>
  <text x="397" y="550" text-anchor="middle" fill="#9ca3af" font-size="7.5">United Nations High Commissioner for Refugees — unhcr.org — This document bears the official UNHCR seal.</text>
</svg>`);

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
      document_url: CERT_SECONDARY,
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
      document_url: CERT_DIPLOMA_ENROLL,
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
      document_url: CERT_DELF,
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
      document_url: REF_SHOPRITE,
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
      document_url: REF_UNHCR,
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
