const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const prisma = new PrismaClient();

async function diagnose() {
  console.log('--- Fixam System Diagnosis ---');
  
  // 1. Check DB
  try {
    await prisma.$connect();
    console.log('✅ Database: Connected successfully');
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    console.log(`✅ Database: Found ${adminCount} Admin users`);
  } catch (err) {
    console.error('❌ Database: Connection failed', err.message);
  }

  // 2. Check Backend Health
  try {
    const res = await axios.get('http://192.168.1.185:5000/health', { timeout: 2000 });
    console.log('✅ Backend API: Healthy', res.data);
  } catch (err) {
    console.log('❌ Backend API: Could not reach via 192.168.1.185:5000. Try localhost:5000');
    try {
      const res = await axios.get('http://localhost:5000/health', { timeout: 2000 });
      console.log('⚠️ Backend API: Only reachable via localhost:5000 (Check 0.0.0.0 binding)');
    } catch (err2) {
      console.error('❌ Backend API: Completely unreachable');
    }
  }

  // 3. Verify JWT Secret
  if (process.env.JWT_SECRET) {
    console.log('✅ Environment: JWT_SECRET is set');
    try {
      const token = jwt.sign({ id: 'test' }, process.env.JWT_SECRET);
      jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ Environment: JWT signing/verifying works');
    } catch (err) {
      console.error('❌ Environment: JWT operation failed', err.message);
    }
  } else {
    console.error('❌ Environment: JWT_SECRET is missing');
  }

  console.log('--- End of Diagnosis ---');
  process.exit(0);
}

diagnose();
