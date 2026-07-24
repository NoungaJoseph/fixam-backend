const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Unified Web Login
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body; // email or phone
    
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }] }
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.password) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // Generate token securely
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

    // Set secure HTTP-only cookie for Cross-Domain auth
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.usefixam.com' : 'localhost'
    });

    // Fetch raw fields not yet in prisma client generated schema
    const rawData = await prisma.$queryRaw`SELECT dob, "careerStatus" FROM "User" WHERE id = ${user.id}`;
    const rawUser = rawData && rawData[0] ? rawData[0] : {};

    res.status(200).json({ success: true, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, dob: rawUser.dob, careerStatus: rawUser.careerStatus }, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password, dob, status } = req.body;
    
    // Check if user exists
    let user = await prisma.user.findFirst({
      where: { email },
      include: { providerProfile: true }
    });
    
    if (user) {
      // User exists. Verify their password to allow seamless integration.
      if (!user.password) {
        return res.status(401).json({ success: false, message: 'Account exists but has no password set. Please reset your password.' });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ success: false, message: 'An account with this email already exists. Please provide the correct password to continue, or go to the login page.' });
      }

      // If password matches, ensure they have a ProviderProfile
      if (!user.providerProfile) {
        await prisma.providerProfile.create({
          data: {
            userId: user.id,
            verification: 'UNVERIFIED',
            profileMode: 'WORK'
          }
        });
      }
      
      // Optionally upgrade role to PROVIDER if they were just a CLIENT
      if (user.role === 'CLIENT') {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { role: 'PROVIDER' },
          include: { providerProfile: true }
        });
      }

    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password || 'default', 10);
      const fullName = `${firstName} ${lastName}`.trim();
      const phone = email; // Fallback to email as phone for now
  
      user = await prisma.user.create({
        data: {
          email,
          phone,
          fullName,
          password: hashedPassword,
          role: 'PROVIDER',
          providerProfile: {
            create: {
              verification: 'UNVERIFIED',
              profileMode: 'WORK'
            }
          }
        },
        include: { providerProfile: true }
      });
    }

    // Save dob and status using executeRaw to avoid Prisma client cache issues
    if (dob || status) {
      const formattedDob = dob ? new Date(dob).toISOString() : null;
      if (formattedDob && status) {
        await prisma.$executeRaw`UPDATE "User" SET "dob" = ${formattedDob}::timestamp, "careerStatus" = ${status} WHERE id = ${user.id}`;
      } else if (formattedDob) {
        await prisma.$executeRaw`UPDATE "User" SET "dob" = ${formattedDob}::timestamp WHERE id = ${user.id}`;
      } else if (status) {
        await prisma.$executeRaw`UPDATE "User" SET "careerStatus" = ${status} WHERE id = ${user.id}`;
      }
    }

    // Generate token securely
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

    // Set secure HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.usefixam.com' : 'localhost'
    });

    // Fetch raw fields not yet in prisma client generated schema
    const rawData = await prisma.$queryRaw`SELECT dob, "careerStatus" FROM "User" WHERE id = ${user.id}`;
    const rawUser = rawData && rawData[0] ? rawData[0] : {};

    res.status(200).json({ success: true, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, dob: rawUser.dob, careerStatus: rawUser.careerStatus }, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Check if email exists
exports.checkEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const existingUser = await prisma.user.findFirst({
      where: { email }
    });

    if (existingUser) {
      return res.status(200).json({ success: true, exists: true });
    }

    res.status(200).json({ success: true, exists: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
