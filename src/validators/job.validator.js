const { z } = require('zod');

const createJobSchema = z.object({
  category: z.string(),
  title: z.string().min(5),
  description: z.string().min(10),
  location: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  budget: z.number().positive().optional(),
  budgetMin: z.number().positive().optional(),
  budgetMax: z.number().positive().optional(),
  providersNeeded: z.number().int().positive().optional(),
  scheduledTime: z.string().optional(),
}).superRefine((data, ctx) => {
  const min = data.budgetMin ?? data.budget;
  const max = data.budgetMax ?? data.budget;
  if (!min || !max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['budget'], message: 'Budget or budget range is required' });
  }
  if (min && max && min > max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['budgetMax'], message: 'Maximum budget must be greater than minimum budget' });
  }
});

module.exports = {
  createJobSchema,
};
