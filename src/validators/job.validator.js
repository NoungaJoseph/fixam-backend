const { z } = require('zod');

const createJobSchema = z.object({
  category: z.string(),
  title: z.string().min(5),
  description: z.string().min(10),
  location: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  budget: z.number().positive(),
  scheduledTime: z.string().optional(),
});

module.exports = {
  createJobSchema,
};
