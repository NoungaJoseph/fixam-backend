const { uploadFile } = require('../services/storage.service');

const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'profile-images', { requireCloud: false, req });
    res.status(200).json({ success: true, url, data: { url }, path: req.file.originalname });
  } catch (error) {
    next(error);
  }
};

const uploadVerificationDoc = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'verification-documents', { requireCloud: false, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'payment-proofs', { requireCloud: false, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadPortfolioMedia = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const bucket = `portfolio-user-${req.user.id}`;
    const url = await uploadFile(req.file, bucket, { requireCloud: false, req });
    res.status(200).json({ success: true, url, data: { url } });
  } catch (error) {
    next(error);
  }
};

const uploadGeneric = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const bucket = req.body?.type === 'video' || req.file?.mimetype?.startsWith('video/') ? 'portfolio-videos' : 'chat-media';
    const url = await uploadFile(req.file, bucket, { requireCloud: false, req });
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
