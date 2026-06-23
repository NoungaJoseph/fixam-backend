const { z } = require('zod');

const topupSchema = z.object({
  body: z.object({
    amount: z.number().int().positive("Top-up amount must be a positive integer"),
    phoneNumber: z.string().min(8, "Phone number is too short"),
    paymentMethod: z.enum(["MTN_MOMO", "ORANGE_MONEY"], {
      errorMap: () => ({ message: "Invalid payment method. Use MTN_MOMO or ORANGE_MONEY" })
    }),
  })
});

module.exports = {
  topupSchema
};
