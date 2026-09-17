const axios = require('axios');
const jwt = require('jsonwebtoken');
const prisma = require('./src/config/prisma');

require('dotenv').config();

async function testPost() {
  try {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const token = jwt.sign({ id: admin.id, role: admin.role }, process.env.JWT_SECRET);

    const profile = await prisma.providerProfile.findFirst({ include: { user: true } });

    const response = await axios.post('http://127.0.0.1:5000/api/admin/verify-provider', {
      providerId: profile.id,
      status: 'REJECTED',
      reason: 'Bad image quality'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log("Response:", response.status, response.data);
  } catch (error) {
    if (error.response) {
      console.error("API Error Response:", error.response.status, error.response.data);
    } else {
      console.error("Error:", error.message);
    }
  }
}
testPost();
