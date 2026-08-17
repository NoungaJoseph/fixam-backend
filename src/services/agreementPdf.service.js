const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates an immutable PDF document for a Fixam Service Agreement in French or English.
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

      const fileName = `${agreement.publicAgreementNumber}-${lang}.pdf`;
      const filePath = path.join(uploadDir, fileName);
      const writeStream = fs.createWriteStream(filePath);

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      doc.pipe(writeStream);

      const terms = agreement.terms || {};
      const client = terms.client || {};
      const provider = terms.provider || {};
      const schedule = terms.schedule || {};
      const materials = Array.isArray(terms.materialsList) ? terms.materialsList : [];

      // Palette
      const primaryColor = '#0D9488'; // Fixam Teal
      const darkColor = '#0F172A';
      const grayColor = '#475569';
      const lightBg = '#F8FAFC';

      // --- HEADER ---
      doc.rect(0, 0, doc.page.width, 90).fill(primaryColor);

      doc.fillColor('#FFFFFF')
         .fontSize(20)
         .font('Helvetica-Bold')
         .text(isFr ? 'CONTRAT DE SERVICE FIXAM' : 'FIXAM SERVICE AGREEMENT', 40, 25);

      doc.fontSize(10)
         .font('Helvetica')
         .text(`${isFr ? 'ID Officiel' : 'Official Document ID'}: ${agreement.publicAgreementNumber} (v${agreement.version})`, 40, 55);

      doc.fontSize(9)
         .text(`${isFr ? 'Émis le' : 'Date Issued'}: ${new Date(agreement.createdAt).toLocaleDateString()}`, doc.page.width - 180, 55, { align: 'right' });

      doc.y = 110;

      // --- SECTION 1: PARTIES ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '1. PARTIES AU CONTRAT' : '1. PARTIES TO THIS AGREEMENT', 40, doc.y);
      doc.moveDown(0.4);

      const partyY = doc.y;
      // Client Box
      doc.rect(40, partyY, 250, 70).fillAndStroke(lightBg, '#CBD5E1');
      doc.fillColor(darkColor).fontSize(10).font('Helvetica-Bold').text('CLIENT', 50, partyY + 10);
      doc.fontSize(8.5).font('Helvetica').text(`${isFr ? 'Nom' : 'Name'}: ${client.name || 'Client'}`, 50, partyY + 24);
      doc.text(`ID: ${client.id ? client.id.substring(0, 8) : 'N/A'}`, 50, partyY + 37);
      if (client.phone) doc.text(`Contact: ${client.phone}`, 50, partyY + 50);

      // Provider Box
      doc.rect(305, partyY, 250, 70).fillAndStroke(lightBg, '#CBD5E1');
      doc.fillColor(darkColor).fontSize(10).font('Helvetica-Bold').text(isFr ? 'PRESTATAIRE DE SERVICE' : 'SERVICE PROVIDER', 315, partyY + 10);
      doc.fontSize(8.5).font('Helvetica').text(`${isFr ? 'Nom' : 'Name'}: ${provider.name || 'Provider'}`, 315, partyY + 24);
      doc.text(`ID: ${provider.id ? provider.id.substring(0, 8) : 'N/A'}`, 315, partyY + 37);
      if (provider.phone) doc.text(`Contact: ${provider.phone}`, 315, partyY + 50);

      doc.y = partyY + 82;

      // --- SECTION 2: SERVICE & SCOPE ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '2. SERVICE ET DESCRIPTION DE LA MISSION' : '2. SERVICE & SCOPE OF WORK', 40, doc.y);
      doc.moveDown(0.4);

      doc.fillColor(grayColor).fontSize(8.5).font('Helvetica-Bold').text(`${isFr ? 'Intitulé' : 'Title'}: `, 40, doc.y, { continued: true });
      doc.font('Helvetica').text(terms.title || 'General Service');
      doc.font('Helvetica-Bold').text(`${isFr ? 'Catégorie' : 'Category'}: `, 40, doc.y, { continued: true });
      doc.font('Helvetica').text(terms.category || 'Maintenance');

      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text(isFr ? 'Détails de la mission :' : 'Scope Details:');
      doc.font('Helvetica').text(terms.scopeOfWork || (isFr ? 'Selon les termes convenus sur Fixam.' : 'As agreed between client and provider via Fixam.'), { width: 515 });

      doc.moveDown(0.8);

      // --- SECTION 3: SCHEDULE, LOCATION & PRICING ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '3. CALENDRIER, LIEU ET TARIF' : '3. SCHEDULE, LOCATION & PRICING', 40, doc.y);
      doc.moveDown(0.4);

      const gridY = doc.y;
      doc.rect(40, gridY, 515, 55).fillAndStroke(lightBg, '#CBD5E1');

      doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold').text(isFr ? 'Date & Heure :' : 'Date & Time:', 50, gridY + 8);
      doc.font('Helvetica').text(`${schedule.date || 'TBD'} ${schedule.time || ''}`, 130, gridY + 8);

      doc.font('Helvetica-Bold').text(isFr ? 'Urgence / Durée :' : 'Urgency / Type:', 50, gridY + 22);
      doc.font('Helvetica').text(`${schedule.urgency || 'Normal'} (${schedule.duration || '1 Day'})`, 130, gridY + 22);

      doc.font('Helvetica-Bold').text(isFr ? 'Lieu :' : 'Location:', 50, gridY + 36);
      doc.font('Helvetica').text(terms.location || 'Client Address', 130, gridY + 36, { width: 370 });

      doc.y = gridY + 63;

      // Agreed Price Banner
      doc.rect(40, doc.y, 515, 26).fill(primaryColor);
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
         .text(`${isFr ? 'RÉMUNÉRATION TOTALE CONVENUE' : 'TOTAL AGREED COMPENSATION'}: ${terms.price ? terms.price.toLocaleString() : '0'} ${terms.currency || 'XAF'}`, 50, doc.y + 7);

      doc.y += 35;

      // --- SECTION 4: MATERIALS & REQUIREMENTS ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '4. MATÉRIEL ET ÉQUIPEMENT' : '4. MATERIALS & REQUIREMENTS', 40, doc.y);
      doc.moveDown(0.4);

      if (materials.length > 0) {
        materials.forEach((item) => {
          doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
             .text(`• ${item.name || item.item || 'Item'} (Qty: ${item.quantity || item.qty || 1}) - ${isFr ? 'Fourni par' : 'Supplying'}: ${item.suppliedBy || 'Provider'}`, 50, doc.y);
        });
      } else {
        doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
           .text(isFr ? 'Aucune liste spécifique. Outillage standard fourni par le prestataire.' : 'No specialized materials list attached. Standard tools supplied by provider.', 50, doc.y);
      }

      doc.moveDown(0.8);

      // --- SECTION 5: OBLIGATIONS & TERMS ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '5. OBLIGATIONS ET RÈGLEMENT DES LITIGES' : '5. OBLIGATIONS & CANCELLATION TERMS', 40, doc.y);
      doc.moveDown(0.4);

      doc.fillColor(grayColor).fontSize(8).font('Helvetica')
         .text(isFr ? '• Le client s\'engage à fournir un accès sécurisé aux locaux à l\'heure convenue.' : '• Client agrees to provide safe access to the premises at the agreed schedule.', 40, doc.y)
         .text(isFr ? '• Le prestataire s\'engage à exécuter le service avec professionnalisme selon les règles de l\'art.' : '• Provider agrees to perform services in a competent, professional manner in accordance with standard trade practices.')
         .text(isFr ? '• Tout litige ou réclamation est traité exclusivement via le Centre de Litiges Officiel de Fixam.' : '• All disputes, cancellations, or claims must be submitted through the official Fixam Dispute System.')
         .text(isFr ? '• Les fonds sont conservés en toute sécurité sous séquestre jusqu\'à la confirmation du service.' : '• Credits and payments are held securely in escrow until job confirmation or dispute resolution.');

      doc.moveDown(0.8);

      // --- SECTION 6: DIGITAL ACCEPTANCE RECORD ---
      doc.fillColor(darkColor).fontSize(11).font('Helvetica-Bold')
         .text(isFr ? '6. STATUT DE VALIDATION CONJOINTE' : '6. DIGITAL ACCEPTANCE RECORD', 40, doc.y);
      doc.moveDown(0.4);

      const accY = doc.y;
      doc.rect(40, accY, 515, 35).fillAndStroke(lightBg, '#CBD5E1');
      doc.fillColor('#059669').fontSize(9).font('Helvetica-Bold')
         .text(isFr ? '✓ CONTRAT ACTIF ET CONFIRMÉ VIA FIXAM' : '✓ OFFICIAL ACTIVE CONTRACT CONFIRMED VIA FIXAM', 50, accY + 10);
      doc.fillColor(grayColor).fontSize(7.5).font('Helvetica')
         .text(isFr ? 'Document exécutoire dès la confirmation de la réservation par les deux parties.' : 'Binding contract record upon booking confirmation. Usable as legal evidence.', 50, accY + 22);

      // --- FOOTER ---
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#94A3B8')
         .text(isFr ? 'Document généré automatiquement via la plateforme Fixam. Soumis aux conditions générales de Fixam.' : 'Document generated automatically via Fixam Marketplace Platform. Subject to Fixam Terms of Service.', 40, doc.page.height - 30, { align: 'center', width: 515 });

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
