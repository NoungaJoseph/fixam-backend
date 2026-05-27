const { uploadFile } = require('../services/storage.service');

const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'profile-images', { requireCloud: true });
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

const uploadVerificationDoc = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'verification-documents');
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'payment-proofs');
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

const uploadGeneric = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'chat-media');
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadProfileImage,
  uploadVerificationDoc,
  uploadPaymentProof,
  uploadGeneric
};
