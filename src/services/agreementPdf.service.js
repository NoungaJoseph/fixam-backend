const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates an immutable professional PDF document for a Fixam Service Agreement in French or English.
 * Saves to uploads/agreements/FSA-YYYY-XXXXXX-vX-[lang].pdf
 */
async function generateAgreementPdf(agreement, lang = 'en') {
  return new Promise((resolve, reject) => {
    try {
      const isFr = lang === 'fr';
      const uploadDir = path.join(process.cwd(), 'uploads', 'agreements');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const docNumber = agreement.publicAgreementNumber || `FSA-${new Date().getFullYear()}-${(agreement.bookingId || agreement.id || 'DOC').substring(0, 8).toUpperCase()}-v1`;
      const fileName = `${docNumber}-${lang}.pdf`;
      const filePath = path.join(uploadDir, fileName);
      const writeStream = fs.createWriteStream(filePath);

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      doc.pipe(writeStream);

      // Parse Terms & Deep Fallbacks
      let terms = agreement.terms || {};
      if (typeof terms === 'string') {
        try { terms = JSON.parse(terms); } catch (_) { terms = {}; }
      }

      const clientRaw = terms.client || agreement.client || {};
      const providerRaw = terms.provider || agreement.provider || {};
      const bookingRaw = agreement.booking || {};
      const scheduleRaw = terms.schedule || {};

      const clientName = clientRaw.name || clientRaw.fullName || agreement.client?.fullName || 'Client';
      const clientId = clientRaw.id || agreement.clientId || agreement.client?.id || 'N/A';
      const clientPhone = clientRaw.phone || agreement.client?.phone || '';
      const clientEmail = clientRaw.email || agreement.client?.email || '';

      const providerName = providerRaw.name || providerRaw.fullName || agreement.provider?.fullName || 'Provider';
      const providerId = providerRaw.id || agreement.providerId || agreement.provider?.id || 'N/A';
      const providerPhone = providerRaw.phone || agreement.provider?.phone || '';
      const providerEmail = providerRaw.email || agreement.provider?.email || '';

      const serviceTitle = terms.title || bookingRaw.notes || 'Fixam Professional Technical Service';
      const serviceCategory = terms.category || 'Home & Maintenance Service';
      const scopeDetails = terms.scopeOfWork || bookingRaw.notes || (isFr ? 'Prestation de service professionnel exécutée selon les normes de qualité et de sécurité Fixam.' : 'Execution of requested professional service in compliance with Fixam quality and safety standards.');
      
      const scheduleDate = scheduleRaw.date || (bookingRaw.bookingDate ? new Date(bookingRaw.bookingDate).toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : (isFr ? 'Date convenue' : 'Agreed Date'));
      const scheduleTime = scheduleRaw.time || bookingRaw.bookingTime || (isFr ? 'Heure convenue' : 'Agreed Time');
      const scheduleDuration = scheduleRaw.duration || bookingRaw.bookingDuration || '1 - 2 Hours';
      const scheduleUrgency = scheduleRaw.urgency || bookingRaw.urgencyLevel || 'NORMAL';
      const jobLocation = terms.location || bookingRaw.location || (isFr ? 'Adresse désignée par le client' : 'Client Designated Address');

      const agreedPrice = Number(terms.price !== undefined ? terms.price : (bookingRaw.counterBudget || bookingRaw.budget || 0));
      const currency = terms.currency || 'XAF';
      const materials = Array.isArray(terms.materialsList) ? terms.materialsList : (Array.isArray(bookingRaw.materialsList) ? bookingRaw.materialsList : []);

      // Corporate Color Scheme
      const primaryColor = '#0D9488'; // Fixam Emerald Teal
      const darkColor = '#0F172A';
      const grayColor = '#475569';
      const lightBg = '#F8FAFC';
      const accentBorder = '#CBD5E1';

      // --- HEADER ---
      doc.rect(0, 0, doc.page.width, 95).fill(primaryColor);

      doc.fillColor('#FFFFFF')
         .fontSize(19)
         .font('Helvetica-Bold')
         .text(isFr ? 'CONTRAT DE SERVICE OFFICIEL FIXAM' : 'FIXAM OFFICIAL SERVICE AGREEMENT', 40, 22);

      doc.fontSize(9.5)
         .font('Helvetica')
         .text(`${isFr ? 'Numéro de Référence' : 'Official Document Ref'}: ${docNumber} (v${agreement.version || 1})`, 40, 52);

      doc.fontSize(8.5)
         .text(`${isFr ? 'Date d\'émission' : 'Date Issued'}: ${new Date(agreement.createdAt || Date.now()).toLocaleDateString(isFr ? 'fr-FR' : 'en-US')}`, doc.page.width - 200, 52, { align: 'right' });

      doc.fontSize(8.5)
         .text(isFr ? 'Statut : ACTIF & VÉRIFIÉ' : 'Status : ACTIVE & VERIFIED', doc.page.width - 200, 68, { align: 'right' });

      doc.y = 115;

      // --- SECTION 1: PARTIES ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '1. PARTIES CONTRACTANTES' : '1. PARTIES TO THIS AGREEMENT', 40, doc.y);
      doc.moveDown(0.4);

      const partyY = doc.y;
      // Client Box
      doc.rect(40, partyY, 250, 75).fillAndStroke(lightBg, accentBorder);
      doc.fillColor(darkColor).fontSize(9.5).font('Helvetica-Bold').text(isFr ? 'CLIENT (DONNEUR D\'ORDRE)' : 'CLIENT (ORDERING PARTY)', 50, partyY + 8);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(primaryColor).text(`${clientName}`, 50, partyY + 22);
      doc.fontSize(8).font('Helvetica').fillColor(grayColor)
         .text(`ID: ${clientId}`, 50, partyY + 36)
         .text(`${isFr ? 'Tél' : 'Tel'}: ${clientPhone || 'Verified on platform'}`, 50, partyY + 48)
         .text(`Email: ${clientEmail || 'Verified account'}`, 50, partyY + 60);

      // Provider Box
      doc.rect(305, partyY, 250, 75).fillAndStroke(lightBg, accentBorder);
      doc.fillColor(darkColor).fontSize(9.5).font('Helvetica-Bold').text(isFr ? 'PRESTATAIRE DE SERVICE' : 'SERVICE PROVIDER', 315, partyY + 8);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(primaryColor).text(`${providerName}`, 315, partyY + 22);
      doc.fontSize(8).font('Helvetica').fillColor(grayColor)
         .text(`ID: ${providerId}`, 315, partyY + 36)
         .text(`${isFr ? 'Tél' : 'Tel'}: ${providerPhone || 'Verified on platform'}`, 315, partyY + 48)
         .text(`Email: ${providerEmail || 'Verified pro account'}`, 315, partyY + 60);

      doc.y = partyY + 88;

      // --- SECTION 2: SERVICE & SCOPE ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '2. OBJET DU SERVICE & CAHIER DES CHARGES' : '2. SERVICE OBJECTIVE & SCOPE OF WORK', 40, doc.y);
      doc.moveDown(0.3);

      doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold').text(`${isFr ? 'Service' : 'Service'}: `, 40, doc.y, { continued: true });
      doc.font('Helvetica').fillColor(primaryColor).text(serviceTitle, { continued: true });
      doc.font('Helvetica-Bold').fillColor(darkColor).text(`  |  ${isFr ? 'Catégorie' : 'Category'}: `, { continued: true });
      doc.font('Helvetica').fillColor(grayColor).text(serviceCategory);

      doc.moveDown(0.4);
      doc.fillColor(darkColor).font('Helvetica-Bold').text(isFr ? 'Description détaillée de la prestation :' : 'Scope & Requirements:');
      doc.font('Helvetica').fillColor(grayColor).text(scopeDetails, { width: 515, align: 'justify' });

      doc.moveDown(0.7);

      // --- SECTION 3: SCHEDULE, LOCATION & PRICING ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '3. PLANNING, LOCALISATION & RÉMUNÉRATION' : '3. SCHEDULE, LOCATION & COMPENSATION', 40, doc.y);
      doc.moveDown(0.3);

      const gridY = doc.y;
      doc.rect(40, gridY, 515, 58).fillAndStroke(lightBg, accentBorder);

      doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold').text(isFr ? 'Date & Heure :' : 'Date & Time:', 50, gridY + 8);
      doc.font('Helvetica').fillColor(grayColor).text(`${scheduleDate} @ ${scheduleTime}`, 135, gridY + 8);

      doc.fillColor(darkColor).font('Helvetica-Bold').text(isFr ? 'Durée & Urgence :' : 'Duration & Urgency:', 50, gridY + 22);
      doc.font('Helvetica').fillColor(grayColor).text(`${scheduleDuration}  |  Urgency: ${scheduleUrgency}`, 135, gridY + 22);

      doc.fillColor(darkColor).font('Helvetica-Bold').text(isFr ? 'Lieu d\'intervention :' : 'Service Location:', 50, gridY + 36);
      doc.font('Helvetica').fillColor(grayColor).text(jobLocation, 135, gridY + 36, { width: 400 });

      doc.y = gridY + 68;

      // Agreed Compensation Banner
      doc.rect(40, doc.y, 515, 26).fill(primaryColor);
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
         .text(`${isFr ? 'RÉMUNÉRATION TOTALE CONVENUE' : 'TOTAL AGREED COMPENSATION'}: ${agreedPrice.toLocaleString()} ${currency}`, 50, doc.y + 7);

      doc.y += 34;

      // --- SECTION 4: MATERIALS & REQUIREMENTS ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '4. MATÉRIEL, OUTILLAGE & ÉQUIPEMENTS' : '4. MATERIALS, TOOLS & EQUIPMENT', 40, doc.y);
      doc.moveDown(0.3);

      if (materials.length > 0) {
        materials.forEach((item) => {
          doc.fillColor(grayColor).fontSize(8).font('Helvetica')
             .text(`• ${item.name || item.item || 'Item'} (Qty: ${item.quantity || item.qty || 1}) — ${isFr ? 'Fourni par' : 'Supplied by'}: ${item.suppliedBy === 'CLIENT' ? (isFr ? 'Client' : 'Client') : (isFr ? 'Prestataire' : 'Provider')}`, 50, doc.y);
        });
      } else {
        doc.fillColor(grayColor).fontSize(8).font('Helvetica')
           .text(isFr ? 'Aucun matériel spécialisé listé. Outillage standard professionnel fourni par le prestataire.' : 'Standard professional tools and regular equipment supplied by the service provider.', 50, doc.y);
      }

      doc.moveDown(0.6);

      // --- SECTION 5: OBLIGATIONS & DISPUTE ESCROW ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '5. OBLIGATIONS CONTRACTUELLES & SÉQUESTRE' : '5. CONTRACTUAL OBLIGATIONS & ESCROW TERMS', 40, doc.y);
      doc.moveDown(0.3);

      doc.fillColor(grayColor).fontSize(7.5).font('Helvetica')
         .text(isFr ? '• Le client s\'engage à garantir un accès sécurisé et libre au lieu d\'intervention aux horaires convenus.' : '• Client agrees to provide safe and unhindered access to the premises at the agreed schedule.', 40, doc.y)
         .text(isFr ? '• Le prestataire s\'engage à réaliser la mission avec diligence et professionnalisme conformément aux règles de l\'art.' : '• Provider agrees to perform services competently, professionally and in adherence to industry safety standards.')
         .text(isFr ? '• Tout litige ou réclamation doit être déposé exclusivement via le Centre de Litiges Fixam sous 72h.' : '• All disputes, discrepancies, or claims must be submitted exclusively via the official Fixam Dispute Resolution Center within 72 hours.')
         .text(isFr ? '• La plateforme Fixam agit en tant que tiers de confiance garantissant la traçabilité des engagements mutuels.' : '• Fixam Platform serves as an impartial digital trust authority ensuring complete mutual traceability.');

      doc.moveDown(0.6);

      // --- SECTION 6: DIGITAL ACCEPTANCE & LEGAL VALIDITY ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '6. VALIDATION NUMÉRIQUE & FORCE PROBANTE' : '6. DIGITAL ACCEPTANCE & LEGAL EVIDENCE RECORD', 40, doc.y);
      doc.moveDown(0.3);

      const accY = doc.y;
      doc.rect(40, accY, 515, 34).fillAndStroke(lightBg, accentBorder);
      doc.fillColor('#059669').fontSize(9).font('Helvetica-Bold')
         .text(isFr ? '✓ ACCORD NUMÉRIQUE MUTUEL ACTIF ET CONFORME VIA FIXAM' : '✓ MUTUAL ACTIVE DIGITAL CONTRACT CONFIRMED VIA FIXAM', 50, accY + 8);
      doc.fillColor(grayColor).fontSize(7).font('Helvetica')
         .text(isFr ? 'Ce document fait foi de contrat juridique entre les parties dès acceptation de la réservation sur la plateforme.' : 'This document constitutes an enforceable legal contract record between both parties upon booking confirmation.', 50, accY + 20);

      // --- FOOTER ---
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#94A3B8')
         .text(isFr ? 'Fixam Marketplace Inc. • Document certifié conforme généré électroniquement • Soumis aux Conditions Générales d\'Utilisation Fixam.' : 'Fixam Marketplace Inc. • Certified electronic contract record • Subject to Fixam Terms of Service & Privacy Policy.', 40, doc.page.height - 25, { align: 'center', width: 515 });

      doc.end();

      writeStream.on('finish', () => {
        const publicUrl = `/uploads/agreements/${fileName}`;
        resolve({ filePath, publicUrl, fileName });
      });

      writeStream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateAgreementPdf,
};
