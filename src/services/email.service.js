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
    console.error('[EmailService] Resend API Error:', error.message);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(error.message);
    }
  }
  
  return data;
};

const sendOTP = async (email, otp, language = 'en') => {
  const isFr = language === 'fr';
  const subject = isFr ? 'Fixam - Votre code de vérification' : 'Fixam - Your OTP Verification Code';
  const message = isFr 
    ? `Votre code de vérification Fixam est : ${otp}. Valide pour 10 minutes.` 
    : `Your Fixam verification code is: ${otp}. Valid for 10 minutes.`;

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
      <h2 style="color: #1E67D1;">${isFr ? 'Code de vérification Fixam' : 'Fixam Verification Code'}</h2>
      <p>${isFr ? 'Bonjour,' : 'Hello,'}</p>
      <p>${isFr ? 'Utilisez le code ci-dessous pour vérifier votre compte sur le marché Fixam.' : 'Use the code below to verify your account on Fixam marketplace.'}</p>
      <div style="background: #F5F5F5; padding: 15px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">
        ${otp}
      </div>
      <p style="font-size: 12px; color: #777; margin-top: 20px;">${isFr ? 'Ce code expire dans 10 minutes. Si vous ne l\'avez pas demandé, veuillez ignorer cet e-mail.' : 'This code expires in 10 minutes. If you did not request this, please ignore this email.'}</p>
    </div>
  `;

  await sendEmail({
    email,
    subject,
    message,
    html
  });
};

const sendWelcomeEmail = async (email, fullName, language = 'en') => {
  const isFr = language === 'fr';
  const subject = isFr ? 'Bienvenue sur Fixam ! 🎉' : 'Welcome to Fixam! 🎉';
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
      <h2 style="color: #1E67D1;">${subject}</h2>
      <p>${isFr ? 'Bonjour' : 'Hello'} ${fullName || (isFr ? 'là' : 'there')},</p>
      <p>${isFr ? 'Nous sommes ravis de vous compter parmi nous sur Fixam, le meilleur marché pour les services. Nous avons crédité votre portefeuille de 1 pièce de bienvenue pour bien commencer !' : 'We are thrilled to have you join Fixam, the best marketplace for services. We have credited your wallet with 1 welcome coin to get you started!'}</p>
      <p>${isFr ? 'Si vous avez des questions, n\'hésitez pas à contacter notre équipe de support.' : 'If you have any questions, feel free to reach out to our support team.'}</p>
      <p>${isFr ? 'Cordialement,' : 'Best regards,'}<br>${isFr ? 'L\'équipe Fixam' : 'The Fixam Team'}</p>
    </div>
  `;
  await sendEmail({ email, subject, html });
};

const sendSuspiciousLoginAlert = async (email, details, language = 'en') => {
  const isFr = language === 'fr';
  const subject = isFr ? 'Alerte de sécurité : Nouvelle connexion détectée' : 'Security Alert: New Login Detected';
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #ff4d4f; border-radius: 10px; max-width: 500px;">
      <h2 style="color: #ff4d4f;">${subject}</h2>
      <p>${isFr ? 'Bonjour,' : 'Hello,'}</p>
      <p>${isFr ? 'Nous avons remarqué une nouvelle connexion à votre compte Fixam depuis un lieu ou un appareil non reconnu.' : 'We noticed a new login to your Fixam account from an unrecognized location or device.'}</p>
      <div style="background: #fff1f0; padding: 15px; border-radius: 8px; color: #cf1322;">
        <strong>${isFr ? 'Détails:' : 'Details:'}</strong><br/>
        ${isFr ? 'Lieu' : 'Location'}: ${details.location}<br/>
        ${isFr ? 'Appareil' : 'Device'}: ${details.device}<br/>
        ${isFr ? 'Heure' : 'Time'}: ${details.time}
      </div>
      <p>${isFr ? 'Si ce n\'était pas vous, veuillez changer votre mot de passe immédiatement.' : 'If this wasn\'t you, please change your password immediately.'}</p>
    </div>
  `;
  await sendEmail({ email, subject, html });
};
const sendMarketingBroadcast = async (emails, subject, content) => {
  // emails can be an array of strings
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px; margin: 0 auto;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="\${process.env.LOGO_URL || 'https://via.placeholder.com/150x50?text=Fixam'}" alt="Fixam Logo" style="max-width: 150px; height: auto;" />
      </div>
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
