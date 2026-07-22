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

// ... Signup, Logout, and Forgot Password would go here
