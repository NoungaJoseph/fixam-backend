require('dotenv').config();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

async function testKora() {
  const transactionId = uuidv4();
  const phone = '237671063170'; // The test number from your logs
  const amount = 100;

  const structuredPayload = {
    reference: transactionId,
    amount: amount,
    currency: 'XAF',
    customer: {
      name: 'Fixam User',
      email: `${transactionId.toLowerCase()}@fixam.app`
    },
    mobile_money: {
      number: phone
    }
  };

  console.log('Testing Kora Pay API with payload:');
  console.log(JSON.stringify(structuredPayload, null, 2));

  try {
    const koraUrl = process.env.KORA_MOBILE_MONEY_URL || 'https://api.korapay.com/merchant/api/v1/charges/mobile-money';
    console.log('\nSending POST request to:', koraUrl);
    
    const response = await axios.post(
      koraUrl,
      structuredPayload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.KORA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('\n✅ SUCCESS!');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.log('\n❌ FAILED!');
    console.log('HTTP Status:', error.response?.status);
    console.log('\n--- FULL KORA API ERROR RESPONSE ---');
    console.log(JSON.stringify(error.response?.data || error.message, null, 2));
    console.log('------------------------------------');
  }
}

testKora();
