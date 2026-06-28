require('dotenv').config();
const { Resend } = require('resend');

async function test() {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY || process.env.EMAIL_PASS);
    console.log('Testing email via Resend SDK...');
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Fixam <support@fixam.net>',
      to: 'noungajoseph58@gmail.com',
      subject: 'Test Email via Resend SDK',
      html: '<p>This is a test message to see if Resend works.</p>'
    });
    
    if (error) {
      console.error('Resend SDK failed:', error);
    } else {
      console.log('Email sent successfully!', data);
    }
  } catch (err) {
    console.error('Crash:', err);
  }
}

test();
