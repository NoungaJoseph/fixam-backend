const { uploadFile } = require('../services/storage.service');
const { processMedia } = require('../services/media.service');

const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    // Compress image before uploading
    const processedFile = await processMedia(req.file);
    const url = await uploadFile(processedFile, 'profile-images', { requireCloud: false, req });
    res.status(200).json({ success: true, url, data: { url }, path: processedFile.originalname });
  } catch (error) {
    next(error);
  }
};

const uploadVerificationDoc = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    // Verification docs: compress images but leave PDFs untouched
    const processedFile = await processMedia(req.file);
    const url = await uploadFile(processedFile, 'verification-documents', { requireCloud: false, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const processedFile = await processMedia(req.file);
    const url = await uploadFile(processedFile, 'payment-proofs', { requireCloud: false, req });
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
    const bucket = 'portfolio-media';
    const url = await uploadFile(processedFile, bucket, { requireCloud: false, req });
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
    const bucket = req.body?.type === 'video' || processedFile.mimetype?.startsWith('video/') ? 'portfolio-videos' : 'chat-media';
    const url = await uploadFile(processedFile, bucket, { requireCloud: false, req });
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
