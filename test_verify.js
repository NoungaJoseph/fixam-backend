const prisma = require('./src/config/prisma');
const { sendEmail } = require('./src/services/email.service');

async function run() {
  try {
    const profile = await prisma.providerProfile.findFirst({
      include: { user: true }
    });
    console.log("Profile ID:", profile.id);

    const isVerified = false;
    const reason = "Bad image quality";
    const status = "REJECTED";
    
    const titleEn = isVerified ? 'Identity Verification Approved' : 'Verification Needs Attention';
    const titleFr = isVerified ? 'Vérification d\'identité approuvée' : 'La vérification nécessite votre attention';
    
    const bodyEn = isVerified
      ? 'Congratulations! Your Fixam identity has been successfully verified. You can now receive and accept more jobs on the platform.'
      : `We could not approve your verification yet.${reason ? ` Reason: ${reason}` : ' Please submit clearer documents and try again.'}`;
      
    const bodyFr = isVerified
      ? 'Félicitations ! L\'identité de votre profil Fixam a été vérifiée avec succès. Vous pouvez désormais recevoir et accepter plus de tâches sur la plateforme.'
      : `Nous n'avons pas pu approuver votre vérification pour le moment.${reason ? ` Raison : ${reason}` : ' Veuillez soumettre des documents plus clairs et réessayer.'}`;

    const pushTitle = `${titleEn} / ${titleFr}`;
    const pushBody = `${bodyEn}\n\n${bodyFr}`;

    const notification = await prisma.notification.create({
      data: {
        userId: profile.userId,
        title: pushTitle,
        body: pushBody,
        data: { type: 'VERIFICATION', status, reason }
      }
    });
    console.log("Notification created", notification.id);
    console.log("Success");
  } catch (err) {
    console.error("Test failed with:", err);
  }
}
run();
