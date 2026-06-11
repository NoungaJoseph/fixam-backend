const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY || process.env.EMAIL_PASS);

const sendEmail = async (options) => {
  const { error, data } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'Fixam <support@fixam.net>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  });

  if (error) {
    throw new Error(error.message);
  }
  
  return data;
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

const sendWelcomeEmail = async (email, fullName) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
      <h2 style="color: #1E67D1;">Welcome to Fixam! 🎉</h2>
      <p>Hello ${fullName || 'there'},</p>
      <p>We are thrilled to have you join Fixam, the best marketplace for services. We have credited your wallet with 1 welcome coin to get you started!</p>
      <p>If you have any questions, feel free to reach out to our support team.</p>
      <p>Best regards,<br>The Fixam Team</p>
    </div>
  `;
  await sendEmail({ email, subject: 'Welcome to Fixam! 🎉', html });
};

const sendSuspiciousLoginAlert = async (email, details) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #ff4d4f; border-radius: 10px; max-width: 500px;">
      <h2 style="color: #ff4d4f;">Security Alert: New Login Detected</h2>
      <p>Hello,</p>
      <p>We noticed a new login to your Fixam account from an unrecognized IP address or device.</p>
      <div style="background: #fff1f0; padding: 15px; border-radius: 8px; color: #cf1322;">
        <strong>Details:</strong><br/>
        IP Address: ${details.ip}<br/>
        Time: ${details.time}
      </div>
      <p>If this was you, you can safely ignore this email.</p>
      <p><strong>If you did NOT log in, please reset your password immediately.</strong></p>
    </div>
  `;
  await sendEmail({ email, subject: 'Security Alert: New Login Detected', html });
};

const sendMarketingBroadcast = async (emails, subject, content) => {
  // emails can be an array of strings
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px;">
      <h2 style="color: #1E67D1;">Fixam Update</h2>
      <div style="font-size: 16px; line-height: 1.5; color: #333;">
        ${content}
      </div>
      <p style="font-size: 12px; color: #777; margin-top: 30px;">You are receiving this email because you are registered on Fixam.</p>
    </div>
  `;
  await sendEmail({ email: emails, subject, html }); // Resend supports passing an array of up to 50 emails to `to`
};

const sendSecurityNotice = async (emails, issueDetails) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #faad14; border-radius: 10px; max-width: 600px;">
      <h2 style="color: #d48806;">⚠️ Important Security Notice</h2>
      <div style="font-size: 16px; line-height: 1.5; color: #333;">
        ${issueDetails}
      </div>
      <p style="font-size: 12px; color: #777; margin-top: 30px;">This is a mandatory service announcement regarding your Fixam account security.</p>
    </div>
  `;
  await sendEmail({ email: emails, subject: 'Important Security Notice from Fixam', html });
};

module.exports = {
  sendOTP,
  sendEmail,
  sendWelcomeEmail,
  sendSuspiciousLoginAlert,
  sendMarketingBroadcast,
  sendSecurityNotice
};
