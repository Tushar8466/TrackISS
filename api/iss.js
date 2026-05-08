export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    // Correcting to the JSON API endpoint instead of the web page
    const response = await fetch('https://api.wheretheiss.at/v1/satellites/25544', {
      headers: { 'User-Agent': 'ISS-Dashboard/1.0' }
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
