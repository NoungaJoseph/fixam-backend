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
    
    // Verify 100% completion
    // Generate PDF logic here...
    const certificateUrl = `https://career.usefixam.com/certificates/${userId}-${categoryKey}.pdf`;

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

