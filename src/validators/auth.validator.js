const { z } = require('zod');

const registerSchema = z.object({
  phone: z.string().min(9).max(15),
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string()
    .min(8)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
  role: z.enum(['CLIENT', 'PROVIDER', 'ADMIN']).optional(),
  country: z.string().optional(),
});

const loginSchema = z.object({
  phone: z.string().min(9).max(15),
  otp: z.string().length(6),
});

module.exports = {
  registerSchema,
  loginSchema,
};
