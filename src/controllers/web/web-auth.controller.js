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

    res.status(200).json({ success: true, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role }, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Signup for CareerPath (creates a PROVIDER user or updates existing)
exports.signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    
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

    // Generate token securely
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

    // Set secure HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.usefixam.com' : 'localhost'
    });

    res.status(200).json({ success: true, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role }, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};
