const { z } = require('zod');

const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().min(5, 'Phone number must be at least 5 characters').max(20).optional().or(z.literal('')),
    password: z.string().min(6, 'Password must be at least 6 characters').max(100),
    role: z.enum(['CLIENT', 'PROVIDER']),
    fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  }).refine(data => data.email || data.phone, {
    message: "Either email or phone is required",
    path: ["email"],
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().min(5, 'Phone number must be at least 5 characters').max(20).optional().or(z.literal('')),
    password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  }).refine(data => data.email || data.phone, {
    message: "Either email or phone is required",
    path: ["email"],
  }),
});

const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    language: z.string().max(10).optional(),
  })
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
};
