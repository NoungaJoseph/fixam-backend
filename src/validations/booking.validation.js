const { z } = require('zod');

const createBookingSchema = z.object({
  body: z.object({
    providerId: z.string().uuid("Invalid provider ID"),
    bookingDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid date format"
    }),
    bookingTime: z.string().min(4, "Time is required"),
    bookingDuration: z.enum(["DAY", "HALF_DAY", "HOURLY", "FIXED"]),
    urgencyLevel: z.enum(["LOW", "NORMAL", "HIGH", "URGENT", "EMERGENCY"]).default("NORMAL"),
    budget: z.number().nonnegative("Budget must be 0 or greater"),
    location: z.string().min(5, "Location must be at least 5 characters long"),
    notes: z.string().optional(),
    taskId: z.string().uuid("Invalid task ID").optional().nullable(),
  }).refine((data) => {
    const isUrgentOrEmergency = ['URGENT', 'EMERGENCY', 'HIGH'].includes(data.urgencyLevel);
    if (!isUrgentOrEmergency && data.budget <= 0) {
      return false;
    }
    return true;
  }, {
    message: "Budget must be greater than 0 for normal bookings",
    path: ["budget"]
  })
});

const updateBookingStatusSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid("Invalid booking ID"),
  }),
  body: z.object({
    status: z.enum(["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED", "COUNTER_PROPOSED"])
  })
});

const counterBookingSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid("Invalid booking ID"),
  }),
  body: z.object({
    counterBudget: z.number().positive("Counter budget must be greater than 0"),
    counterNotes: z.string().optional()
  })
});

module.exports = {
  createBookingSchema,
  updateBookingStatusSchema,
  counterBookingSchema
};
