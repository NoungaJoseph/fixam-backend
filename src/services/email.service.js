const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async (options) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  await transporter.sendMail(mailOptions);
};

const sendOTP = async (email, otp) => {
  const message = `Your Fixam verification code is: ${otp}. Valid for 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
      <h2 style="color: #1E67D1;">Fixam Verification Code</h2>
      <p>Hello,</p>
      <p>Use the code below to verify your account on Fixam marketplace.</p>
      <div style="background: #F5F5F5; padding: 15px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">
        ${otp}
      </div>
      <p style="font-size: 12px; color: #777; margin-top: 20px;">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
    </div>
  `;

  await sendEmail({
    email,
    subject: 'Fixam - Your OTP Verification Code',
    message,
    html
  });
};

module.exports = {
  sendOTP,
  sendEmail
};
