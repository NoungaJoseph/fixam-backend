const { Resend } = require('resend');

let _resendClient = null;
const getResendClient = () => {
  if (_resendClient) return _resendClient;
  const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_PASS || '').trim();
  if (!apiKey) {
    console.warn('[EmailService] RESEND_API_KEY / EMAIL_PASS is not set in environment.');
    return null;
  }
  try {
    _resendClient = new Resend(apiKey);
    return _resendClient;
  } catch (err) {
    console.error('[EmailService] Resend initialization failed:', err.message);
    return null;
  }
};

/**
 * Clean default send helper
 */
const sendEmail = async (options) => {
  try {
    const fromAddress = options.from || process.env.EMAIL_FROM || 'Fixam <noreply@fixam.net>';
    const payload = {
      from: fromAddress,
      to: options.email || options.to,
      subject: options.subject,
      text: options.message || options.text,
      html: options.html,
    };

    if (options.replyTo || options.reply_to) {
      payload.replyTo = options.replyTo || options.reply_to;
      payload.reply_to = options.replyTo || options.reply_to;
    }

    if (options.attachments && options.attachments.length > 0) {
      payload.attachments = options.attachments;
    }

    const client = getResendClient();
    if (!client) {
      console.warn('[EmailService] Resend is unconfigured; skipping email delivery.');
      return { success: false, error: 'Email service not configured' };
    }

    const { error, data } = await client.emails.send(payload);

    if (error) {
      console.warn('[EmailService] Resend API Warning:', error.message);
      return { success: false, error: error.message };
    }
    
    return { success: true, data };
  } catch (err) {
    console.error('[EmailService] Send failure:', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * OTP Verification Email
 * From: security@fixam.net
 * Clean text, no background box or colored card containers
 */
const sendOTP = async (email, otp, language = 'en') => {
  console.log(`[OTP] Generated verification code for ${email}: ${otp}`);
  const isFr = language === 'fr';
  const subject = isFr ? 'Fixam - Votre code de vérification' : 'Fixam - Your OTP Verification Code';
  const message = isFr 
    ? `Votre code de vérification Fixam est : ${otp}. Valide pour 10 minutes.\n\nFixam Security Team - security@fixam.net` 
    : `Your Fixam verification code is: ${otp}. Valid for 10 minutes.\n\nFixam Security Team - security@fixam.net`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; color: #111827; line-height: 1.6; font-size: 15px;">
      <h2 style="color: #111827; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">${isFr ? 'Code de vérification Fixam' : 'Fixam Verification Code'}</h2>
      <p style="margin: 0 0 12px 0;">${isFr ? 'Bonjour,' : 'Hello,'}</p>
      <p style="margin: 0 0 20px 0;">${isFr ? 'Utilisez le code de vérification ci-dessous pour confirmer votre compte Fixam :' : 'Use the verification code below to confirm your account on Fixam:'}</p>
      <p style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0f172a; margin: 24px 0;">
        ${otp}
      </p>
      <p style="font-size: 13px; color: #6b7280; margin: 24px 0 0 0;">${isFr ? "Ce code expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet e-mail en toute sécurité." : "This code expires in 10 minutes. If you did not request this code, you can safely ignore this email."}</p>
      <p style="font-size: 13px; color: #9ca3af; margin: 16px 0 0 0;">Fixam Security Team • security@fixam.net</p>
    </div>
  `;

  return sendEmail({
    from: process.env.EMAIL_SECURITY_FROM || 'Fixam Security <security@fixam.net>',
    email,
    subject,
    message,
    html
  });
};

/**
 * Welcome Email
 * From: noreply@fixam.net
 * Clean plain layout, no background cards
 */
const sendWelcomeEmail = async (email, fullName, language = 'en') => {
  const isFr = language === 'fr';
  const subject = isFr ? 'Bienvenue sur Fixam ! 🎉' : 'Welcome to Fixam! 🎉';
  const message = isFr
    ? `Bonjour ${fullName || 'là'},\n\nBienvenue sur Fixam ! Nous avons crédité votre portefeuille de 1 pièce de bienvenue pour bien commencer.\n\nCordialement,\nL'équipe Fixam\nhttps://usefixam.com • support@fixam.net`
    : `Hello ${fullName || 'there'},\n\nWelcome to Fixam! We have credited your wallet with 1 welcome coin to get you started.\n\nBest regards,\nThe Fixam Team\nhttps://usefixam.com • support@fixam.net`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; color: #111827; line-height: 1.6; font-size: 15px;">
      <h2 style="color: #111827; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">${subject}</h2>
      <p style="margin: 0 0 12px 0;">${isFr ? 'Bonjour' : 'Hello'} ${fullName || (isFr ? 'là' : 'there')},</p>
      <p style="margin: 0 0 16px 0;">${isFr ? 'Bienvenue sur Fixam ! Votre compte est prêt et nous avons crédité votre portefeuille de 1 pièce de bienvenue pour commencer.' : 'Welcome to Fixam! Your account is ready and we have credited your wallet with 1 welcome coin to get you started.'}</p>
      <p style="margin: 0 0 16px 0;">${isFr ? "Explorez nos services, trouvez des professionnels qualifiés ou postulez directement aux opportunités professionnelles." : "Explore verified professionals, find work opportunities, or post your service needs directly on the platform."}</p>
      <p style="margin: 24px 0 0 0;">
        ${isFr ? 'Cordialement,' : 'Best regards,'}<br/>
        <strong>${isFr ? "L'équipe Fixam" : 'The Fixam Team'}</strong>
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0 0;">Fixam • https://usefixam.com • support@fixam.net</p>
    </div>
  `;

  return sendEmail({
    from: process.env.EMAIL_NOREPLY_FROM || 'Fixam <noreply@fixam.net>',
    email,
    subject,
    message,
    html
  });
};

/**
 * Suspicious Login Alert
 * From: security@fixam.net
 * Clean plain layout, no red box container
 */
const sendSuspiciousLoginAlert = async (email, details, language = 'en') => {
  const isFr = language === 'fr';
  const subject = isFr ? 'Alerte de sécurité : Nouvelle connexion détectée' : 'Security Alert: New Login Detected';
  const message = `${subject}\n\nLocation: ${details.location}\nDevice: ${details.device}\nTime: ${details.time}\n\nIf this was not you, please reset your password immediately at https://usefixam.com\nFixam Security • security@fixam.net`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; color: #111827; line-height: 1.6; font-size: 15px;">
      <h2 style="color: #b91c1c; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">${subject}</h2>
      <p style="margin: 0 0 12px 0;">${isFr ? 'Bonjour,' : 'Hello,'}</p>
      <p style="margin: 0 0 16px 0;">${isFr ? 'Nous avons détecté une nouvelle connexion à votre compte Fixam :' : 'We noticed a new login to your Fixam account from an unrecognized location or device:'}</p>
      
      <p style="margin: 4px 0;"><strong>${isFr ? 'Lieu' : 'Location'}:</strong> ${details.location}</p>
      <p style="margin: 4px 0;"><strong>${isFr ? 'Appareil' : 'Device'}:</strong> ${details.device}</p>
      <p style="margin: 4px 0;"><strong>${isFr ? 'Heure' : 'Time'}:</strong> ${details.time}</p>

      <p style="margin: 20px 0 0 0;">${isFr ? "Si ce n'était pas vous, veuillez changer votre mot de passe immédiatement sur Fixam." : "If this wasn't you, please change your password immediately on Fixam."}</p>
      <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0 0;">Fixam Security Team • security@fixam.net</p>
    </div>
  `;

  return sendEmail({
    from: process.env.EMAIL_SECURITY_FROM || 'Fixam Security <security@fixam.net>',
    email,
    subject,
    message,
    html
  });
};

/**
 * Marketing & Broadcast
 * From: noreply@fixam.net
 */
const sendMarketingBroadcast = async (emails, subject, content) => {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; color: #111827; line-height: 1.6; font-size: 15px;">
      <h2 style="color: #0f172a; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">Fixam Update</h2>
      <div style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
        ${content}
      </div>
      <p style="font-size: 12px; color: #9ca3af; margin: 30px 0 0 0;">You are receiving this email because you are registered on Fixam • support@fixam.net</p>
    </div>
  `;
  return sendEmail({
    from: process.env.EMAIL_FROM || 'Fixam <noreply@fixam.net>',
    email: emails,
    subject,
    html
  });
};

/**
 * Academy completion email
 * From: noreply@fixam.net
 */
const sendModuleCompletionEmail = async (email, fullName, moduleName, score) => {
  const subject = `Congratulations! You've completed ${moduleName} 🎓`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; color: #111827; line-height: 1.6; font-size: 15px;">
      <h2 style="color: #0f172a; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">${subject}</h2>
      <p style="margin: 0 0 12px 0;">Hello ${fullName || 'there'},</p>
      <p style="margin: 0 0 16px 0;">Great job! You have successfully completed the <strong>${moduleName}</strong> module with a score of <strong>${score}%</strong>.</p>
      <p style="margin: 0 0 16px 0;">Keep up the great momentum and continue progressing on your career path.</p>
      <p style="margin: 24px 0 0 0;">
        Best regards,<br/>
        <strong>The Fixam Academy Team</strong>
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0 0;">Fixam Academy • https://usefixam.com</p>
    </div>
  `;
  return sendEmail({
    from: process.env.EMAIL_NOREPLY_FROM || 'Fixam <noreply@fixam.net>',
    email,
    subject,
    html
  });
};

/**
 * Security Notice
 * From: security@fixam.net
 */
const sendSecurityNotice = async (emails, issueDetails) => {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; color: #111827; line-height: 1.6; font-size: 15px;">
      <h2 style="color: #b91c1c; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">Important Security Notice</h2>
      <div style="font-size: 15px; line-height: 1.6; color: #1f2937; margin-bottom: 24px;">
        ${issueDetails}
      </div>
      <p style="font-size: 12px; color: #9ca3af; margin: 30px 0 0 0;">Mandatory security notification from Fixam Security • security@fixam.net</p>
    </div>
  `;
  return sendEmail({
    from: process.env.EMAIL_SECURITY_FROM || 'Fixam Security <security@fixam.net>',
    email: emails,
    subject: 'Important Security Notice from Fixam',
    html
  });
};

/**
 * External Job Application Submission Email
 * From: submit@fixam.net (e.g. "${applicantName} (via Fixam)" <submit@fixam.net>)
 * Reply-To: applicant's direct email
 * Format: Plain, clean, professional letter layout with NO background box/cards
 * Supports: Google Sheets / Drive / Web URL and attached binary files (PDF or Photo)
 */
const sendExternalJobApplication = async ({
  to,
  applicantName,
  applicantEmail,
  applicantPhone,
  jobTitle,
  companyName,
  coverLetter,
  cvLink,
  isPriority = false,
  attachments = []
}) => {
  try {
    const rawFrom = process.env.EMAIL_APPLICATIONS_FROM || process.env.EMAIL_JOBS_FROM || 'submit@fixam.net';
    const match = rawFrom.match(/<([^>]+)>/);
    const senderEmail = match ? match[1] : rawFrom.trim();
    
    // Display name: "${applicantName} (via Fixam)"
    const cleanName = (applicantName || 'Applicant').replace(/[<>"']/g, '').trim();
    const fromAddress = `"${cleanName} (via Fixam)" <${senderEmail}>`;

    const subjectPrefix = isPriority ? '[RECOMMENDED TOP CANDIDATE] ' : '';
    const subject = `${subjectPrefix}Application for ${jobTitle} - ${cleanName}`;
    const safeCoverLetter = coverLetter && coverLetter.trim()
      ? coverLetter.trim()
      : 'Please find my application and CV attached for your review.';

    const textBody = `${isPriority ? 'PRIORITY CANDIDATE APPLICATION (FIXAM RECOMMENDED)\n\n' : ''}Dear Hiring Team at ${companyName || 'the Organization'},

I am writing to submit my application for the position of ${jobTitle}.

${safeCoverLetter}

Applicant Contact Details:
- Name: ${cleanName}
- Email: ${applicantEmail}
${applicantPhone ? `- Phone: ${applicantPhone}` : ''}
${cvLink ? `- View & Download CV: ${cvLink}` : ''}
${attachments && attachments.length > 0 ? `- Attachment: ${attachments.map(a => a.filename).join(', ')}` : ''}

Thank you for your time and consideration. You can reply directly to this email to reach me.

Best regards,
${cleanName}

(Submitted via Fixam Platform. Hitting reply emails the applicant directly at ${applicantEmail})`;

    const priorityBannerHtml = isPriority ? `
        <div style="background-color: #fefce8; border: 1.5px solid #eab308; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
          <p style="margin: 0; color: #854d0e; font-weight: 750; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase;">
            Fixam Recommended &bull; Priority Candidate
          </p>
          <p style="margin: 4px 0 0 0; color: #a16207; font-size: 13px; line-height: 1.5;">
            This candidate boosted their application with Fixam Coins. Their verified qualifications and credentials are ready for priority consideration.
          </p>
        </div>
    ` : '';

    const cvActionHtml = cvLink ? `
        <div style="margin: 22px 0; padding: 16px 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
          <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Candidate Curriculum Vitae (CV)</p>
          <a href="${cvLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 22px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 4px;">
            Open Candidate CV &rarr;
          </a>
          <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b;">Click to view the candidate's complete resume.</p>
        </div>
    ` : '';

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; color: #111827; line-height: 1.6; font-size: 15px;">
        ${priorityBannerHtml}
        <h2 style="color: #0f172a; font-size: 20px; font-weight: 700; margin: 0 0 4px 0;">Job Application: ${jobTitle}</h2>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">Submitted to <strong>${companyName}</strong> via Fixam</p>

        <p style="margin: 0 0 16px 0;">Dear Hiring Team at <strong>${companyName || 'the Organization'}</strong>,</p>

        <p style="margin: 0 0 16px 0;">I am writing to submit my application for the position of <strong>${jobTitle}</strong>.</p>

        <div style="margin: 20px 0; font-size: 15px; color: #1f2937; white-space: pre-wrap; line-height: 1.7;">
${safeCoverLetter}
        </div>

        ${cvActionHtml}

        <div style="margin: 28px 0 16px 0; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin: 0 0 10px 0;">Applicant Contact Details</p>
          <p style="margin: 4px 0;"><strong>Name:</strong> ${cleanName}</p>
          <p style="margin: 4px 0;"><strong>Email:</strong> <a href="mailto:${applicantEmail}" style="color: #2563eb; text-decoration: underline;">${applicantEmail}</a></p>
          ${applicantPhone ? `<p style="margin: 4px 0;"><strong>Phone:</strong> <a href="tel:${applicantPhone}" style="color: #2563eb; text-decoration: underline;">${applicantPhone}</a></p>` : ''}
          ${cvLink ? `<p style="margin: 8px 0;"><strong>CV Link:</strong> <a href="${cvLink}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; font-weight: 600; text-decoration: underline;">${cvLink}</a></p>` : ''}
          ${attachments && attachments.length > 0 ? `<p style="margin: 4px 0;"><strong>Attached File:</strong> 📎 ${attachments.map(a => a.filename).join(', ')}</p>` : ''}
        </div>

        <p style="margin: 20px 0 0 0;">Thank you for your consideration. You can reply directly to this email to reach me.</p>

        <p style="margin: 20px 0 0 0;">
          Best regards,<br/>
          <strong>${cleanName}</strong>
        </p>

        <p style="margin: 32px 0 0 0; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
          This application was submitted by ${cleanName} through the Fixam Career Platform. Replying directly to this email responds to the candidate at <a href="mailto:${applicantEmail}" style="color: #6b7280;">${applicantEmail}</a>.
        </p>
      </div>
    `;

    const sendPayload = {
      from: fromAddress,
      to,
      replyTo: applicantEmail,
      reply_to: applicantEmail,
      subject,
      text: textBody,
      html: htmlBody,
    };

    if (attachments && attachments.length > 0) {
      sendPayload.attachments = attachments;
    }

    const client = getResendClient();
    if (!client) {
      console.warn('[EmailService] Resend is unconfigured; skipping job application email delivery.');
      return { success: false, error: 'Email service not configured' };
    }

    const { error, data } = await client.emails.send(sendPayload);

    if (error) {
      console.error('[EmailService] Resend API Error on job application:', error);
      return { success: false, error: error.message };
    }

    console.log(`[EmailService] Job application successfully sent for ${cleanName} to ${to}, resendId=${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error('[EmailService] Send job application failure:', err.message);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendEmail,
  sendOTP,
  sendWelcomeEmail,
  sendSuspiciousLoginAlert,
  sendMarketingBroadcast,
  sendSecurityNotice,
  sendModuleCompletionEmail,
  sendExternalJobApplication
};
