const { google } = require('googleapis');

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
}

// Columns that are metadata, not events
const SKIP_HEADERS = new Set([
  'name of guest', 'number of people', 'rsvp', 'city/town', 'contact info', 'code',
]);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code query param is required' });

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = process.env.GUEST_SHEET_ID;
    const configuredName = (process.env.GUEST_SHEET_NAME || '').trim();

    // Discover the actual sheet tab name
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const availableSheets = meta.data.sheets.map(s => s.properties.title);
    console.log('Available sheets:', availableSheets);

    const sheetName = availableSheets.find(
      t => t.toLowerCase() === configuredName.toLowerCase()
    ) || availableSheets[0];
    console.log('Using sheet:', sheetName);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });

    const rows = response.data.values || [];
    // Row 0 = date labels, row 1 = column headers, data starts at row 2
    if (rows.length < 3) return res.status(200).json({ found: false });

    const dateRow  = rows[0];
    const headers  = rows[1];
    const dataRows = rows.slice(2);

    const nameColIndex = headers.findIndex(h => h.trim().toLowerCase() === 'name of guest');
    const codeColIndex = headers.findIndex(h => h.trim().toLowerCase() === 'code');

    const codeLower = code.trim().toLowerCase();
    const guestRow = dataRows.find(row =>
      (row[codeColIndex] || '').trim().toLowerCase() === codeLower
    );

    if (!guestRow) return res.status(200).json({ found: false });

    const events = headers
      .map((header, i) => ({
        header: header.trim(),
        val:    (guestRow[i] || '').trim(),
        date:   (dateRow[i]  || '').trim(),
      }))
      .filter(({ header, val }) =>
        !SKIP_HEADERS.has(header.toLowerCase()) && val !== ''
      )
      .map(({ header, val, date }) => ({
        name:  header,
        date:  date || null,
        limit: parseInt(val, 10) || null,
      }));

    return res.status(200).json({
      found: true,
      name:  nameColIndex >= 0 ? (guestRow[nameColIndex] || '').trim() : '',
      events,
    });
  } catch (err) {
    console.error('lookup error:', err);
    return res.status(500).json({ error: 'Failed to look up guest' });
  }
};
