require('dotenv').config();
const { sendEmail } = require('./src/services/email.service');

async function test() {
  try {
    console.log('Testing email via Nodemailer...');
    await sendEmail({
      email: 'noungajoseph58@gmail.com', // user's email based on git commit history
      subject: 'Test Email via Nodemailer',
      message: 'This is a test message to see if Nodemailer works.',
      html: '<p>This is a test message to see if Nodemailer works.</p>'
    });
    console.log('Email sent successfully!');
  } catch (err) {
    console.error('Email failed:', err);
  }
}

test();
