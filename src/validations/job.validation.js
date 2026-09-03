const { z } = require('zod');

const createJobSchema = z.object({
  body: z.object({
    category: z.string().min(2, "Category is required"),
    title: z.string().min(5, "Title must be at least 5 characters"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    location: z.string().min(3, "Location is required"),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    budget: z.number().positive("Budget must be a positive number"),
    budgetMin: z.number().positive().optional().nullable(),
    budgetMax: z.number().positive().optional().nullable(),
    providersNeeded: z.number().int().positive().optional(),
    scheduledTime: z.string().optional().nullable(),
    isRemote: z.boolean().optional().nullable(),
    importantDetails: z.string().optional().nullable(),
    whatNeedsDone: z.string().optional().nullable(),
    taskScope: z.string().optional().nullable(),
    preferences: z.array(z.string()).optional(),
    priority: z.string().optional(),
    requiresDiagnosis: z.boolean().optional(),
    materialsList: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        quantity: z.string().optional().nullable(),
        suppliedBy: z.enum(["CLIENT", "PROVIDER"])
      })
    ).optional().nullable(),
  }).refine(data => {
    if (data.budgetMin && data.budgetMax) {
      return data.budgetMax >= data.budgetMin;
    }
    return true;
  }, {
    message: "budgetMax must be greater than or equal to budgetMin",
    path: ["budgetMax"]
  })
});

module.exports = {
  createJobSchema
};
