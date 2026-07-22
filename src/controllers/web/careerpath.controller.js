const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Careerpath Onboarding: Select Skills
exports.onboardSkills = async (req, res) => {
  try {
    const { userId } = req.user;
    const { selectedSkills } = req.body;
    
    // Save selected skills to user profile
    const profile = await prisma.providerProfile.upsert({
      where: { userId },
      update: { skills: selectedSkills },
      create: { userId, skills: selectedSkills, verification: "UNVERIFIED" }
    });

    res.status(200).json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Enroll in a career path
exports.enroll = async (req, res) => {
  try {
    const { userId } = req.user;
    const { categoryKey } = req.body;
    
    const enrollment = await prisma.careerpathEnrollment.create({
      data: { userId, categoryKey, status: 'ACTIVE' }
    });

    res.status(201).json({ success: true, enrollment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const { sendModuleCompletionEmail } = require('../../services/email.service');

// Complete a module & handle smart exam
exports.completeModuleWithExam = async (req, res) => {
  try {
    const { userId } = req.user;
    const { categoryKey, moduleId, examScore } = req.body;
    
    // Require minimum score to progress
    if (examScore < 70) {
      return res.status(400).json({ success: false, message: 'Exam failed. Minimum 70% required to progress.' });
    }

    const progress = await prisma.careerpathModuleProgress.upsert({
      where: { userId_categoryKey_moduleId: { userId, categoryKey, moduleId } },
      update: { isCompleted: true, score: examScore, completedAt: new Date() },
      create: { userId, categoryKey, moduleId, isCompleted: true, score: examScore, completedAt: new Date() }
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true }
    });

    if (user?.email) {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      // Send the email non-blocking
      sendModuleCompletionEmail(user.email, fullName, moduleId, examScore).catch(e => {
        console.error("Failed to send module completion email", e);
      });
    }

    // Recalculate total progress here...

    res.status(200).json({ success: true, progress });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Generate certificate upon completion
exports.generateCertificate = async (req, res) => {
  try {
    const { userId } = req.user;
    const { categoryKey } = req.body;
    
    // Check if the certificate already exists
    const existingCert = await prisma.careerpathCertificate.findFirst({
      where: { userId, categoryKey }
    });

    if (existingCert) {
      return res.status(200).json({ success: true, cert: existingCert, message: 'Certificate already exists.' });
    }

    const fs = require('fs');
    const path = require('path');
    const PDFDocument = require('pdfkit');

    // Create certificates directory if it doesn't exist
    const certDir = path.join(__dirname, '../../../public/certificates');
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    const fileName = `${userId}-${categoryKey}-${Date.now()}.pdf`;
    const filePath = path.join(certDir, fileName);

    const doc = new PDFDocument({ layout: 'landscape', size: 'A4' });
    doc.pipe(fs.createWriteStream(filePath));

    // Basic Certificate Design
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke('#0D9488');
    
    doc.fillColor('#0D9488').fontSize(40).text('CERTIFICATE OF COMPLETION', { align: 'center' }, 120);
    doc.fillColor('#333333').fontSize(20).text('This is proudly presented to', { align: 'center' }, 200);
    doc.fillColor('#111111').fontSize(30).text(`User #${userId}`, { align: 'center' }, 250);
    doc.fillColor('#333333').fontSize(16).text(`For successfully completing the ${categoryKey} career path training.`, { align: 'center' }, 320);
    
    doc.fontSize(14).text(`Date: ${new Date().toLocaleDateString()}`, 100, 450);
    doc.text('Fixam Academy', doc.page.width - 200, 450);
    
    doc.end();

    const certificateUrl = `https://api.usefixam.com/public/certificates/${fileName}`;

    const cert = await prisma.careerpathCertificate.create({
      data: { userId, categoryKey, certificateUrl }
    });

    res.status(201).json({ success: true, cert });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get Dashboard Data for user
exports.getUserDashboard = async (req, res) => {
  try {
    const { userId } = req.user;
    
    const enrollments = await prisma.careerpathEnrollment.findMany({
      where: { userId },
    });

    const certificates = await prisma.careerpathCertificate.findMany({
      where: { userId }
    });

    res.status(200).json({ 
      success: true, 
      activePaths: enrollments,
      achievements: certificates,
      recommended: [] // In a real app, this would be computed based on profile skills
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

