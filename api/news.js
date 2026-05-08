export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  const { category } = req.query;
  const apiKey = process.env.VITE_NEWS_API_KEY;
  try {
    // Sticking to GNews as configured in the project
    const url = `https://gnews.io/api/v4/top-headlines?category=${category || 'general'}&lang=en&apikey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
