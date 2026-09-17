const { z } = require('zod');

const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    phone: z.string().min(5, 'Phone number must be at least 5 characters').max(20).optional().or(z.literal('')),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(100)
      .regex(/[A-Z]/, 'Password must include an uppercase letter')
      .regex(/[0-9]/, 'Password must include a number')
      .regex(/[^A-Za-z0-9]/, 'Password must include a special character'),
    role: z.enum(['CLIENT', 'PROVIDER']),
    fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
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
