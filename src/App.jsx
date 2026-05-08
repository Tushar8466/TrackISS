import React, { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

const ISS_API = 'https://api.wheretheiss.at/v1/satellites/25544';
const ASTROS_API = 'http://api.open-notify.org/astros.json';
const GEOCODE_API = (lat, lng) => `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
const NEWS_API_KEY = import.meta.env.VITE_NEWS_API_KEY;
const NEWS_CATEGORIES = ['technology', 'science', 'business', 'health', 'general'];


function App() {
  // ISS State
  const [positions, setPositions] = useState([]);
  const [astros, setAstros] = useState({ people: [], number: 0 });
  const [currentLocation, setCurrentLocation] = useState('Tracking...');
  const [speedData, setSpeedData] = useState([]);
  const [isDark, setIsDark] = useState(false);
  const [loading, setLoading] = useState(true);

  // News State
  const [articles, setArticles] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [activeCategory, setActiveCategory] = useState('technology');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('publishedAt'); // 'publishedAt' or 'source'

  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const polylineRef = useRef(null);
  const mapContainerRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    mapRef.current = L.map(mapContainerRef.current, {
      center: [0, 0],
      zoom: 2,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapRef.current);

    const issIcon = L.divIcon({
      className: 'iss-icon',
      html: '<div class="iss-marker-container">🛰️</div>',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    markerRef.current = L.marker([0, 0], { icon: issIcon }).addTo(mapRef.current);
    polylineRef.current = L.polyline([], { color: '#3b82f6', weight: 3, opacity: 0.6 }).addTo(mapRef.current);

    const init = async () => {
      await fetchISS();
      fetchAstros();
      setLoading(false);
    };
    
    init();
    const interval = setInterval(fetchISS, 10000);

    return () => {
      clearInterval(interval);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Fetch news when category changes
  useEffect(() => {
    fetchNews(activeCategory);
  }, [activeCategory]);

  const fetchAstros = async () => {
    try {
      const res = await fetch(ASTROS_API);
      const data = await res.json();
      setAstros(data);
    } catch (err) {
      console.error('Astros fetch error', err);
    }
  };

  const fetchNews = async (category, forceRefresh = false) => {
    setNewsLoading(true);
    setNewsError(null);

    const cacheKey = `news_cache_${category}`;
    const cached = localStorage.getItem(cacheKey);

    if (!forceRefresh && cached) {
      const { value, expires } = JSON.parse(cached);
      if (Date.now() < expires) {
        setArticles(value);
        setNewsLoading(false);
        return;
      }
    }

    if (!NEWS_API_KEY) {
      setNewsError('GNews API key is missing. Please add VITE_NEWS_API_KEY to your .env file.');
      setNewsLoading(false);
      return;
    }

    try {
      // GNews API structure: category, lang, apikey
      const res = await fetch(`https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&apikey=${NEWS_API_KEY}`);
      const data = await res.json();
      
      if (data.errors) {
        throw new Error(data.errors[0] || 'Failed to fetch news from GNews');
      }

      const newsArticles = data.articles || [];
      setArticles(newsArticles);

      // Cache for 15 minutes
      localStorage.setItem(cacheKey, JSON.stringify({
        value: newsArticles,
        expires: Date.now() + 15 * 60 * 1000
      }));
    } catch (err) {
      setNewsError(err.message);
    } finally {
      setNewsLoading(false);
    }
  };


  const fetchISS = async () => {
    try {
      const res = await fetch(ISS_API);
      const data = await res.json();
      const lat = parseFloat(data.latitude);
      const lng = parseFloat(data.longitude);
      const timestamp = data.timestamp;
      const velocity = data.velocity;
      updateState(lat, lng, timestamp, velocity);
    } catch (err) {
      console.error('ISS fetch error', err);
    }
  };

  const updateState = async (lat, lng, timestamp, velocity) => {
    const timeStr = new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setPositions(prev => {
      const newPos = [...prev, { lat, lng, timestamp, timeStr }].slice(-50);
      const currentSpeed = velocity ? Math.round(velocity) : 27600;
      setSpeedData(prevSpeed => [...prevSpeed, { time: timeStr, speed: currentSpeed }].slice(-20));
      if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
      if (polylineRef.current) polylineRef.current.setLatLngs(newPos.map(p => [p.lat, p.lng]));
      if (prev.length === 0 && mapRef.current) mapRef.current.setView([lat, lng], 3);
      return newPos;
    });

    try {
      const geoRes = await fetch(GEOCODE_API(lat, lng));
      const geoData = await geoRes.json();
      setCurrentLocation(geoData.city || geoData.locality || geoData.principalSubdivision || 'Over Ocean / Remote Area');
    } catch {
      setCurrentLocation('Over Ocean');
    }
  };

  const filteredArticles = articles
    .filter(a => {
      const term = searchQuery.toLowerCase();
      return (a.title?.toLowerCase().includes(term) || a.description?.toLowerCase().includes(term));
    })
    .sort((a, b) => {
      if (sortBy === 'publishedAt') {
        return new Date(b.publishedAt) - new Date(a.publishedAt);
      } else {
        return (a.source?.name || '').localeCompare(b.source?.name || '');
      }
    });

  const lastPos = positions[positions.length - 1] || { lat: 0, lng: 0 };
  const currentSpeed = speedData[speedData.length - 1]?.speed || 0;

  return (
    <div className="dashboard">
      <nav className="top-nav">
        <div className="title-group">
          <h6>Mission Control Dashboard</h6>
          <h1>Real-Time ISS and News Intelligence</h1>
        </div>
        <button className="btn btn-toggle" onClick={() => setIsDark(!isDark)}>
          {isDark ? '☀️ Switch to Light' : '🌙 Switch to Dark'}
        </button>
      </nav>

      <main className="card tracking-card">
        <div className="card-header">
          <h2 className="card-title">ISS Live Tracking</h2>
          <div style={{display:'flex', gap:'8px'}}>
            <button className="btn" onClick={fetchISS}>Refresh Now</button>
            <button className="btn" style={{borderColor: '#22c55e', color:'#22c55e'}}>Auto-Refresh: ON</button>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-item">
            <div className="stat-label">Latitude / Longitude</div>
            <div className="stat-value">{lastPos.lat.toFixed(3)}, {lastPos.lng.toFixed(3)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Speed</div>
            <div className="stat-value">{currentSpeed.toLocaleString()} km/h</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Nearest Place</div>
            <div className="stat-value" style={{fontSize:'0.9rem'}}>{currentLocation}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Tracked Positions</div>
            <div className="stat-value">{positions.length}</div>
          </div>
        </div>

        <div id="map" ref={mapContainerRef}></div>
      </main>

      <aside className="card chart-card">
        <div className="card-header">
          <h2 className="card-title">ISS Speed Trend</h2>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={speedData}>
              <defs>
                <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="time" hide />
              <YAxis domain={['dataMin - 100', 'dataMax + 100']} hide />
              <Tooltip 
                contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px' }}
                itemStyle={{ color: '#3b82f6' }}
              />
              <Area type="monotone" dataKey="speed" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSpeed)" strokeWidth={3}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </aside>

      <div className="bottom-section">
        <section className="card news-card">
          <div className="card-header">
            <h2 className="card-title">Latest Headlines</h2>
            <button className="btn" onClick={() => fetchNews(activeCategory, true)}>Refresh Category</button>
          </div>

          <div className="news-tabs">
            {NEWS_CATEGORIES.map(cat => (
              <button 
                key={cat} 
                className={`news-tab ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>

          <div className="news-controls">
            <input 
              type="text" 
              placeholder="Search articles..." 
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select 
              className="btn" 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="publishedAt">Sort by Date</option>
              <option value="source">Sort by Source</option>
            </select>
          </div>

          {newsLoading ? (
            <div className="news-list">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton-card skeleton"></div>
              ))}
            </div>
          ) : newsError ? (
            <div className="error-container">
              <p style={{color: '#ef4444', marginBottom: '16px'}}>{newsError}</p>
              <button className="btn" onClick={() => fetchNews(activeCategory, true)}>Retry</button>
            </div>
          ) : (
            <div className="news-list">
              {filteredArticles.map((article, i) => (
                <article key={i} className="news-item">
                  <div className="news-img-container">
                    <img 
                      src={article.image || 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=500&auto=format&fit=crop'} 
                      alt={article.title} 
                      className="news-img" 
                      onError={(e) => { e.target.src = 'https://via.placeholder.com/500x280?text=No+Image'; }}
                    />
                  </div>
                  <div className="news-content">
                    <div className="news-meta">
                      <span>{article.source?.name}</span>
                      <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
                    </div>
                    <h3>{article.title}</h3>
                    <p>{article.description || 'No description available for this article.'}</p>
                    <div className="news-footer">
                      <small style={{color: 'var(--text-muted)'}}>By {article.author || 'Unknown'}</small>
                      <a href={article.url} target="_blank" rel="noopener noreferrer" className="btn" style={{color: 'var(--accent)'}}>Read More</a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="card astronauts-card">
          <div className="card-header">
            <h2 className="card-title">People in Space</h2>
            <div className="badge" style={{background:'#3b82f6', color:'white', padding:'4px 12px', borderRadius:'12px', fontSize:'0.8rem'}}>{astros.number} Total</div>
          </div>
          <div className="astro-grid">
            {astros.people.map((person, i) => (
              <div key={i} className="astro-item">
                <div className="astro-avatar">{person.name.charAt(0)}</div>
                <div className="astro-info">
                  <div style={{fontWeight:'700'}}>{person.name}</div>
                  <div style={{fontSize:'0.8rem', color:'var(--text-muted)'}}>{person.craft}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;

