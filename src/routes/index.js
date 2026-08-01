import { Router } from 'express';
import authRoutes from './auth.js';
import passportRoutes from './passport.js';
import credentialRoutes from './credentials.js';
import workExperienceRoutes from './workExperience.js';
import educationRoutes from './education.js';
import organizationRoutes from './organizations.js';
import jurisdictionRoutes from './jurisdictions.js';
import recognitionRoutes from './recognition.js';
import auditRoutes from './audit.js';
import adminRoutes from './admin.js';
import uploadsRoutes from './uploads.js';
import jobsRoutes from './jobs.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/passport', passportRoutes);
router.use('/credentials', credentialRoutes);
router.use('/work-experience', workExperienceRoutes);
router.use('/education', educationRoutes);
router.use('/organizations', organizationRoutes);
router.use('/jurisdictions', jurisdictionRoutes);
router.use('/recognition', recognitionRoutes);
router.use('/audit', auditRoutes);
router.use('/admin', adminRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/jobs', jobsRoutes);

export default router;
