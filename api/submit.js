const { google } = require('googleapis');

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, code, responses, counts } = req.body || {};

  if (!name || !responses || typeof responses !== 'object') {
    return res.status(400).json({ error: 'name and responses are required' });
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetId = process.env.RESPONSE_SHEET_ID;
    const configuredName = (process.env.RESPONSE_SHEET_NAME || 'Response').trim();
    const timestamp = new Date().toISOString();

    // Discover exact sheet tab name
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const availableTabs = meta.data.sheets.map(s => s.properties.title);
    const sheetName = availableTabs.find(t => t.toLowerCase() === configuredName.toLowerCase()) || configuredName;

    // Read existing rows
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: sheetName });
    const allRows = existing.data.values || [];

    // Remove previous rows for this code (column index 2)
    const codeLower = (code || '').trim().toLowerCase();
    const kept = codeLower
      ? allRows.filter(row => (row[2] || '').trim().toLowerCase() !== codeLower)
      : allRows;

    // Build new rows: timestamp | name | code | event | response | guestCount
    const newRows = Object.entries(responses).map(([event, response]) => [
      timestamp,
      name.trim(),
      (code || '').trim(),
      event,
      response,
      (counts && counts[event] != null) ? Number(counts[event]) : '',
    ]);

    // Clear and rewrite
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: sheetName });
    const allNewRows = [...kept, ...newRows];
    if (allNewRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: sheetName,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: allNewRows },
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(500).json({ error: 'Failed to save RSVP' });
  }
};
