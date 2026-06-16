const { z } = require('zod');

const updateProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  password: z.string().min(6).optional(),
  avatar: z.string().url().optional(),
  fcmToken: z.string().optional(),
  dob: z.string().optional(),
  location: z.string().optional(),
  bio: z.string().optional(),
  skills: z.array(z.string()).optional(),
  rate: z.number().optional(),
  serviceArea: z.string().optional(),
  experienceLevel: z.string().optional(),
  portfolio: z.array(z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional()
  })).optional(),
  certificates: z.array(z.object({
    title: z.string().optional(),
    issuer: z.string().optional(),
    year: z.string().optional(),
    imageUrl: z.string().optional()
  })).optional(),
  employmentHistory: z.array(z.object({
    title: z.string().optional(),
    company: z.string().optional(),
    period: z.string().optional(),
    description: z.string().optional()
  })).optional(),
  socialLinks: z.object({
    linkedin: z.string().optional(),
    facebook: z.string().optional(),
    instagram: z.string().optional(),
    tiktok: z.string().optional()
  }).optional(),
  profileMode: z.enum(['PERSONAL', 'WORK']).optional(),
});

module.exports = {
  updateProfileSchema,
};
