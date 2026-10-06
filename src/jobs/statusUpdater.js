const prisma = require('../config/prisma');

// Function to check and update tasks that should be "IN_PROGRESS"
async function updatePendingTasksToInProgress() {
  try {
    const now = new Date();
    
    // Find ACCEPTED bookings where the scheduled time has arrived or passed
    const acceptedBookings = await prisma.booking.findMany({
      where: {
        status: 'ACCEPTED'
      }
    });

    for (const booking of acceptedBookings) {
      if (booking.bookingDate && booking.bookingTime) {
        // Create a date object for the scheduled time
        const scheduledDate = new Date(booking.bookingDate);
        
        // Parse "HH:mm" from bookingTime
        const timeParts = booking.bookingTime.split(':');
        if (timeParts.length >= 2) {
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          
          scheduledDate.setHours(hours, minutes, 0, 0);
          
          // If scheduled time has arrived
          if (now >= scheduledDate) {
            console.log(`[JobUpdater] Transitioning Booking ${booking.id} to IN_PROGRESS`);
            await prisma.booking.update({
              where: { id: booking.id },
              data: { status: 'IN_PROGRESS' }
            });
          }
        }
      }
    }
    
    // Check Jobs as well if they follow a similar pattern
    const assignedJobs = await prisma.job.findMany({
      where: {
        status: 'ASSIGNED'
      }
    });

    for (const job of assignedJobs) {
        if (job.scheduledDate && job.scheduledTime) {
            const scheduledDate = new Date(job.scheduledDate);
            const timeParts = job.scheduledTime.split(':');
            if (timeParts.length >= 2) {
              const hours = parseInt(timeParts[0], 10);
              const minutes = parseInt(timeParts[1], 10);
              scheduledDate.setHours(hours, minutes, 0, 0);

              if (now >= scheduledDate) {
                  console.log(`[JobUpdater] Transitioning Job ${job.id} to IN_PROGRESS`);
                  await prisma.job.update({
                    where: { id: job.id },
                    data: { status: 'IN_PROGRESS' }
                  });
              }
            }
        }
    }

    // Auto-expire regular jobs where expiryDate has passed
    const expiredJobs = await prisma.job.findMany({
      where: {
        status: 'PENDING',
        expiryDate: { lte: now }
      },
      select: { id: true, title: true }
    });

    if (expiredJobs.length > 0) {
      console.log(`[JobUpdater] Expiring ${expiredJobs.length} passed-deadline regular jobs`);
      await prisma.job.updateMany({
        where: {
          status: 'PENDING',
          expiryDate: { lte: now }
        },
        data: { status: 'CANCELLED' }
      });
    }

    // Auto-expire External Jobs
    try {
      const expiredExtResult = await prisma.externalJob.updateMany({
        where: {
          status: { not: 'EXPIRED' },
          expiryDate: { lte: now }
        },
        data: { status: 'EXPIRED' }
      });
      if (expiredExtResult.count > 0) {
        console.log(`[JobUpdater] Marked ${expiredExtResult.count} external jobs as EXPIRED`);
      }

      // Flag External Jobs that need re-verification
      const needsRecheckResult = await prisma.externalJob.updateMany({
        where: {
          status: 'ACTIVE',
          reverifyAt: { lte: now },
          expiryDate: { gt: now }
        },
        data: { status: 'NEEDS_RECHECK' }
      });
      if (needsRecheckResult.count > 0) {
        console.log(`[JobUpdater] Flagged ${needsRecheckResult.count} external jobs as NEEDS_RECHECK`);
      }
    } catch (extJobErr) {
      // ExternalJob table might not be migrated yet in some dev environments
      if (!extJobErr.message?.includes('does not exist')) {
        console.warn('[JobUpdater] External jobs update notice:', extJobErr.message);
      }
    }

  } catch (error) {
    console.error('[JobUpdater] Error updating task statuses:', error.message);
  }
}

// Start the cron job every minute
function startStatusUpdater() {
  console.log('[JobUpdater] Started background status updater job');
  setInterval(updatePendingTasksToInProgress, 60000); // Check every minute
}

module.exports = { startStatusUpdater };

