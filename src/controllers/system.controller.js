const getSystemStatus = async (req, res) => {
  try {
    const prisma = require('../config/prisma');

    let maintenanceEnabled = false;
    let maintenanceMessage = 'We are improving Fixam for you. Back soon!';

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'global' },
        select: { maintenanceEnabled: true, maintenanceMessage: true }
      });

      if (settings) {
        maintenanceEnabled = settings.maintenanceEnabled === true;
        if (settings.maintenanceMessage) {
          maintenanceMessage = settings.maintenanceMessage;
        }
      }
    } catch (dbError) {
      // If DB fails, definitely not in maintenance — proceed normally
      console.warn('[System] DB error on status check:', dbError.message);
      maintenanceEnabled = false;
    }

    return res.json({
      success: true,
      maintenance: maintenanceEnabled,
      message: maintenanceMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Never block app startup on error
    return res.json({
      success: true,
      maintenance: false,
      message: ''
    });
  }
};

module.exports = { getSystemStatus };
