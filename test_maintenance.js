const jwt = require('jsonwebtoken');
const axios = require('axios');

async function testBackend() {
  try {
    const JWT_SECRET = 'fixam_secure_jwt_secret_2026_9988';
    
    // 1. Generate an admin token
    const token = jwt.sign({ id: 'admin123', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
    console.log('Token generated.');

    const API_BASE = 'https://fixam-backend-production.up.railway.app/api';
    const config = { headers: { Authorization: `Bearer ${token}` } };

    // 2. Fetch current settings
    console.log('Fetching current settings...');
    let res = await axios.get(`${API_BASE}/admin/settings`, config);
    let settings = res.data.data;
    console.log('Current App Maintenance:', settings.appMaintenanceEnabled);
    console.log('Current Web Maintenance:', settings.webMaintenanceEnabled);

    // 3. Update settings to turn maintenance ON
    console.log('\nTurning maintenance ON...');
    settings.appMaintenanceEnabled = true;
    settings.webMaintenanceEnabled = true;
    
    res = await axios.put(`${API_BASE}/admin/settings`, settings, config);
    console.log('Update result:', res.data.success);
    
    // 4. Verify system status endpoint (public)
    console.log('\nFetching public system status...');
    res = await axios.get(`${API_BASE}/system/status`);
    console.log('Status Response:', res.data);

    // 5. Turn it back OFF so we don't leave it broken
    console.log('\nTurning maintenance OFF...');
    settings.appMaintenanceEnabled = false;
    settings.webMaintenanceEnabled = false;
    res = await axios.put(`${API_BASE}/admin/settings`, settings, config);
    console.log('Update result:', res.data.success);

  } catch (err) {
    console.error('Error during test:', err.response ? err.response.data : err.message);
  }
}

testBackend();
