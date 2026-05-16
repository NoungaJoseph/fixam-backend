const { uploadFile } = require('../services/storage.service');

const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'profiles');
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

const uploadVerificationDoc = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'verification');
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'payments');
    res.status(200).json({ success: true, url });
  } catch (error) {
    next(error);
  }
};

const uploadGeneric = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const url = await uploadFile(req.file, 'uploads');
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
