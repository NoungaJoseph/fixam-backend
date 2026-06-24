const getSystemStatus = async (req, res) => {
  try {
    const prisma = require('../config/prisma');

    let appMaintenanceEnabled = false;
    let webMaintenanceEnabled = false;
    let maintenanceMessage = 'We are improving Fixam for you. Back soon!';

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'global' },
        select: { appMaintenanceEnabled: true, webMaintenanceEnabled: true, maintenanceMessage: true }
      });

      if (settings) {
        appMaintenanceEnabled = settings.appMaintenanceEnabled === true;
        webMaintenanceEnabled = settings.webMaintenanceEnabled === true;
        if (settings.maintenanceMessage) {
          maintenanceMessage = settings.maintenanceMessage;
        }
      }
    } catch (dbError) {
      // If DB fails, definitely not in maintenance — proceed normally
      console.warn('[System] DB error on status check:', dbError.message);
      appMaintenanceEnabled = false;
      webMaintenanceEnabled = false;
    }

    return res.json({
      success: true,
      appMaintenanceEnabled,
      webMaintenanceEnabled,
      message: maintenanceMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Never block app startup on error
    return res.json({
      success: true,
      appMaintenanceEnabled: false,
      webMaintenanceEnabled: false,
      message: ''
    });
  }
};

module.exports = { getSystemStatus };
