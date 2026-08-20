const { uploadFile } = require('../services/storage.service');
const { processMedia } = require('../services/media.service');
const prisma = require('../config/prisma');

const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // Compress image before uploading
    let processedFile;
    try {
      processedFile = await processMedia(req.file);
    } catch (mediaErr) {
      console.warn('[uploadProfileImage] Media processing skipped:', mediaErr.message);
      processedFile = req.file;
    }

    const url = await uploadFile(processedFile, 'profile-images', { requireCloud: true, req });

    // Automatically update user avatar in DB and clear session cache
    if (req.user?.id) {
      try {
        await prisma.user.update({
          where: { id: req.user.id },
          data: { avatar: url }
        });
        const { clearUserCache } = require('../middlewares/auth.middleware');
        clearUserCache(req.user.id);
      } catch (dbErr) {
        console.warn('[uploadProfileImage] Auto-update avatar DB error:', dbErr.message);
      }
    }

    res.status(200).json({ success: true, url, data: { url }, path: processedFile.originalname });
  } catch (error) {
    console.error('[uploadProfileImage Error]:', error);
    next(error);
  }
};

const uploadVerificationDoc = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // Verification docs: compress images but leave PDFs untouched
    const processedFile = await processMedia(req.file);
    const url = await uploadFile(processedFile, 'verification-documents', { requireCloud: true, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const processedFile = await processMedia(req.file);
    const url = await uploadFile(processedFile, 'payment-proofs', { requireCloud: true, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadPortfolioMedia = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // Compress portfolio images and videos before uploading
    const processedFile = await processMedia(req.file);
    // All portfolio media (images AND videos) go to a single 'portfolio-media' bucket
    const url = await uploadFile(processedFile, 'portfolio-media', { requireCloud: true, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadGeneric = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // Compress media before uploading
    const processedFile = await processMedia(req.file);
    const bucket = req.body?.type === 'video' || processedFile.mimetype?.startsWith('video/') ? 'portfolio-media' : 'chat-media';
    const url = await uploadFile(processedFile, bucket, { requireCloud: true, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadProfileImage,
  uploadVerificationDoc,
  uploadPaymentProof,
  uploadPortfolioMedia,
  uploadGeneric
};
