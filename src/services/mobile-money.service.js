const axios = require('axios')
const { v4: uuidv4 } = require('uuid')

async function requestToPayWithKora({
  amount,
  currency = 'XAF',
  description,
  redirectUrl,
  notificationUrl,
  name = 'Fixam User',
  email = 'user@fixam.net',
  phone
}) {
  const formattedPhone = String(phone || '').replace(/\s+/g, '')
    .replace(/-/g, '').replace('+', '')
  
  const prefixes = ['237', '254', '233', '225', '255', '20', '234']
  const hasPrefix = prefixes.some(p => formattedPhone.startsWith(p))
  const phoneNumber = hasPrefix ? formattedPhone : '237' + formattedPhone

  // Validate required fields
  if (!amount || amount <= 0) {
    return { error: ['Amount must be positive'] }
  }
  if (!phoneNumber || !/^\d{8,15}$/.test(phoneNumber)) {
    return { error: ['Phone must be 8-15 digits'] }
  }
  if (!notificationUrl || !redirectUrl) {
    return { error: ['Notification and redirect URLs required'] }
  }

  const transactionId = uuidv4()

  const structuredPayload = {
    amount: Number(amount),
    currency: currency,
    reference: transactionId,
    description: 'Fixam App - ' + (description || 'coin purchase'),
    notification_url: notificationUrl,
    redirect_url: redirectUrl,
    customer: {
      name: 'Fixam - ' + (name || 'User'),
      email: email || 'payments@fixam.net'
    },
    merchant_bears_cost: false,
    mobile_money: {
      number: phoneNumber
    }
  }

  try {
    const koraRequest = await axios.post(
      process.env.KORA_MOBILE_MONEY_URL,
      structuredPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.KORA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )

    const response = koraRequest.data
    console.log('[Kora] Payment initiated:', transactionId)

    return {
      response: response.data,
      reference: transactionId,
      redirectUrl,
      notificationUrl
    }

  } catch (error) {
    console.error('[Kora] Payment initiation failed:',
      error.response?.data || error.message)
    return {
      error: [error.response?.data?.message ||
        'Payment initiation failed']
    }
  }
}

async function getPaymentStatusFromKora(transactionRef) {
  try {
    const url = process.env.KORA_PAYMENT_STATUS_URL
      ?.replace(':reference', transactionRef)

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.KORA_SECRET_KEY}`
      }
    })

    const result = response.data
    console.log('[Kora] Status check:', transactionRef,
      result.data?.status)

    return {
      data: {
        status: result.data.status,
        transId: result.data.reference,
        reason: result.message
      }
    }

  } catch (error) {
    console.error('[Kora] Status check failed:',
      error.response?.data || error.message)
    return {
      data: {
        status: 'failed',
        transId: transactionRef,
        reason: error.response?.data?.message ||
          'Status check failed'
      }
    }
  }
}

module.exports = { requestToPayWithKora, getPaymentStatusFromKora }
