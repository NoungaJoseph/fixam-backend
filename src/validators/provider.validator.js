const { z } = require('zod');

const setupProviderSchema = z.object({
  skills: z.array(z.string()).min(1),
  bio: z.string().min(10).optional(),
  rate: z.number().positive().optional(),
  availability: z.record(z.any()).optional(),
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
  setupProviderSchema,
};
