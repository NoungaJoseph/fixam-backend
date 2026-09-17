const { z } = require('zod');

const updateProviderProfileSchema = z.object({
  body: z.object({
    skills: z.array(z.string()).optional(),
    bio: z.string().max(1000, "Bio cannot exceed 1000 characters").optional(),
    rate: z.number().positive().optional(),
    serviceArea: z.string().optional(),
    experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "EXPERT"]).optional(),
    availability: z.record(z.any()).optional(),
  })
});

module.exports = {
  updateProviderProfileSchema
};
