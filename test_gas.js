const url = 'https://script.google.com/macros/s/AKfycbxaFk6IyrzRQaxW4fnHwis-ydurVMdXy19f5NHXvc3cMyjLAsgOAH5gJ8zLp2175soo/exec';

async function testGoogleAppsScript() {
  console.log('Sending test POST request to:', url);
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        action: 'onboarding',
        data: {
          id: 'TEST_ID_123',
          employeeName: 'TESTING',
          email: 'test@example.com',
          password: 'testpassword'
        }
      })
    });
    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Response body:', text);
    
    if (text.includes('<html')) {
      console.log('ERROR: Received HTML response. This means the Apps Script deployment does not have "Anyone" access, or it requires login.');
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testGoogleAppsScript();
