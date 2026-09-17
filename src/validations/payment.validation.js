const { z } = require('zod');

const topupSchema = z.object({
  body: z.object({
    amount: z.number().int().positive("Top-up amount must be a positive integer"),
    phone: z.string().min(8, "Phone number is too short"),
    coins: z.number().int().positive("Coins must be a positive integer"),
  })
});

module.exports = {
  topupSchema
};
