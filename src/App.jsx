import React, { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell
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
  const [issError, setIssError] = useState(null);
  const [issLoading, setIssLoading] = useState(false);

  // News State
  const [articles, setArticles] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [activeCategory, setActiveCategory] = useState('technology');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('publishedAt');
  const [categoryCounts, setCategoryCounts] = useState({});

  // Chatbot State
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('chatbot_messages');
    return saved ? JSON.parse(saved) : [];
  });
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const polylineRef = useRef(null);
  const mapContainerRef = useRef(null);
  const chatEndRef = useRef(null);

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
  const AI_TOKEN = import.meta.env.VITE_AI_TOKEN;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem('chatbot_messages', JSON.stringify(messages.slice(-30)));
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage = { 
      role: 'user', 
      text: chatInput, 
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    
    setMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsTyping(true);

    const lastPos = positions[positions.length - 1] || { lat: 0, lng: 0 };
    const currentSpeedVal = speedData[speedData.length - 1]?.speed || 0;
    const astrosList = astros.people.map(p => p.name).join(', ');
    const newsSummaries = articles.slice(0, 15).map(a => `${a.title}: ${a.description}`).join(' | ');

    const systemPrompt = `You are an International Space Station Mission Control Assistant. You ONLY answer questions using the provided dashboard data. Do NOT use outside knowledge or guess.

DASHBOARD DATA:
- International Space Station Position: Latitude ${lastPos.lat.toFixed(4)}, Longitude ${lastPos.lng.toFixed(4)}
- Speed: ${currentSpeedVal.toLocaleString()} km/h
- Nearest Place: ${currentLocation}
- Astronauts (${astros.number} total): ${astrosList}
- Latest Headlines: ${newsSummaries}
`;

    const prompt = `<s>[INST] ${systemPrompt}\n\nUser Question: ${chatInput} [/INST]`;

    try {
      const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
        headers: { Authorization: `Bearer ${AI_TOKEN}`, "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 250, return_full_text: false } }),
      });

      const data = await response.json();
      let botText = (Array.isArray(data) && data[0]?.generated_text) ? data[0].generated_text.trim() : (data.error || "Error processing request.");

      setMessages(prev => [...prev, { 
        role: 'bot', 
        text: botText, 
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: 'Connection failed.', timestamp: '--:--' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem('chatbot_messages');
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

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
    markerRef.current.bindPopup('<b>Initializing Satellite...</b>');
    polylineRef.current = L.polyline([], { color: '#3b82f6', weight: 3, opacity: 0.6 }).addTo(mapRef.current);

    const init = async () => {
      setIssLoading(true);
      await fetchISS();
      fetchAstros();
      fetchAllCategoryCounts();
      setLoading(false);
      setIssLoading(false);
    };
    
    init();
    const interval = setInterval(fetchISS, 30000); // Increased to 30s for better rate-limit safety

    return () => {
      clearInterval(interval);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    fetchNews(activeCategory);
  }, [activeCategory]);

  const fetchAstros = async () => {
    try {
      const res = await fetch(ASTROS_API);
      const data = await res.json();
      setAstros(data);
    } catch (err) {
      console.error('Astros error', err);
    }
  };

  const fetchAllCategoryCounts = async () => {
    const counts = {};
    for (const cat of NEWS_CATEGORIES) {
      const cached = localStorage.getItem(`news_cache_${cat}`);
      counts[cat] = cached ? JSON.parse(cached).value.length : 10;
    }
    setCategoryCounts(counts);
  };

  const fetchNews = async (category, forceRefresh = false) => {
    setNewsLoading(true);
    setNewsError(null);
    if (forceRefresh) setArticles([]);

    const cacheKey = `news_cache_${category}`;
    const cached = localStorage.getItem(cacheKey);

    if (!forceRefresh && cached) {
      const { value, expires } = JSON.parse(cached);
      if (Date.now() < expires) {
        setArticles(value);
        setNewsLoading(false);
        setCategoryCounts(prev => ({ ...prev, [category]: value.length }));
        return;
      }
    }

    try {
      const res = await fetch(`https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&apikey=${NEWS_API_KEY}`);
      if (res.status === 429) throw new Error('Rate limit exceeded');
      const data = await res.json();
      const newsArticles = data.articles || [];
      setArticles(newsArticles);
      setCategoryCounts(prev => ({ ...prev, [category]: newsArticles.length }));
      localStorage.setItem(cacheKey, JSON.stringify({ value: newsArticles, expires: Date.now() + 15 * 60 * 1000 }));
    } catch (err) {
      setNewsError(err.message);
    } finally {
      setNewsLoading(false);
    }
  };

  const fetchISS = async () => {
    setIssError(null);
    setIssLoading(true);
    try {
      const res = await fetch(ISS_API);
      
      if (res.status === 429) {
        console.warn('Primary API rate limited. Attempting fallback...');
        // Fallback to Open Notify for basic coordinates if primary fails
        const fallbackRes = await fetch('http://api.open-notify.org/iss-now.json');
        if (fallbackRes.ok) {
          const fbData = await fallbackRes.json();
          updateState(parseFloat(fbData.iss_position.latitude), parseFloat(fbData.iss_position.longitude), fbData.timestamp, null);
          setIssError('Using backup telemetry (Primary API rate-limited)');
        } else {
          setIssError('Telemetry unavailable. Retrying in 30s...');
        }
        return;
      }

      const data = await res.json();
      if (!data || data.latitude === undefined) return;
      
      updateState(parseFloat(data.latitude), parseFloat(data.longitude), data.timestamp, data.velocity);
    } catch (err) {
      setIssError('Telemetry connection failed');
    } finally {
      setIssLoading(false);
    }
  };

  const updateState = async (lat, lng, timestamp, velocity) => {
    if (isNaN(lat) || isNaN(lng)) return;
    const timeStr = new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const currentSpeedVal = velocity ? Math.round(velocity) : (speedData.length > 0 ? speedData[speedData.length-1].speed : 27600);

    // Update positions
    setPositions(prev => {
      const newPos = [...prev, { lat, lng, timestamp, timeStr }].slice(-50);
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
        markerRef.current.getPopup().setContent(`
          <b>ISS Position</b><br/>Lat: ${lat.toFixed(4)}<br/>Lng: ${lng.toFixed(4)}<br/>Speed: ${currentSpeedVal.toLocaleString()} km/h
        `);
      }
      if (polylineRef.current) polylineRef.current.setLatLngs(newPos.map(p => [p.lat, p.lng]));
      if (prev.length === 0 && mapRef.current) mapRef.current.setView([lat, lng], 3);
      return newPos;
    });

    // Update Speed Data (last 30)
    setSpeedData(prev => [...prev, { time: timeStr, speed: currentSpeedVal }].slice(-30));

    try {
      const geoRes = await fetch(GEOCODE_API(lat, lng));
      const geoData = await geoRes.json();
      setCurrentLocation(geoData.city || geoData.locality || 'Over Ocean');
    } catch {
      setCurrentLocation('Over Ocean');
    }
  };

  const filteredArticles = articles.filter(a => {
    const term = searchQuery.toLowerCase();
    return (a.title?.toLowerCase().includes(term) || a.description?.toLowerCase().includes(term));
  }).sort((a, b) => sortBy === 'publishedAt' ? new Date(b.publishedAt) - new Date(a.publishedAt) : (a.source?.name || '').localeCompare(b.source?.name || ''));

  const doughnutData = NEWS_CATEGORIES.map(cat => ({
    name: cat.charAt(0).toUpperCase() + cat.slice(1),
    value: categoryCounts[cat] || 0,
    catId: cat
  }));

  const lastPos = positions[positions.length - 1] || { lat: 0, lng: 0 };
  const currentSpeedVal = speedData[speedData.length - 1]?.speed || 0;

  return (
    <div className="dashboard">
      <nav className="top-nav">
        <div className="title-group">
          <h6>Mission Control Dashboard</h6>
          <h1>Real-Time International Space Station and News Intelligence</h1>
        </div>
        <button className="btn btn-toggle" onClick={() => setIsDark(!isDark)}>
          {isDark ? '☀️ Light' : '🌙 Dark'}
        </button>
      </nav>

      <main className="card tracking-card">
        <div className="card-header">
          <h2 className="card-title">International Space Station Live Tracking</h2>
          <div style={{display:'flex', gap:'8px'}}>
            <button className="btn" onClick={fetchISS} disabled={issLoading}>Refresh</button>
            <button className="btn" style={{borderColor: '#22c55e', color:'#22c55e'}}>Auto: 20s</button>
          </div>
        </div>

        {issError && <div className="error-banner" style={{background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '16px'}}>⚠️ {issError}</div>}

        <div className="stats-row">
          <div className="stat-item">
            <div className="stat-label">Lat / Lng</div>
            <div className="stat-value">{positions.length > 0 ? `${lastPos.lat.toFixed(3)}, ${lastPos.lng.toFixed(3)}` : '---'}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Speed</div>
            <div className="stat-value">{positions.length > 0 ? `${currentSpeedVal.toLocaleString()} km/h` : '---'}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Location</div>
            <div className="stat-value" style={{fontSize:'0.9rem'}}>{currentLocation}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Positions</div>
            <div className="stat-value">{positions.length}</div>
          </div>
        </div>

        <div id="map" ref={mapContainerRef}></div>
      </main>

      <aside className="card chart-card">
        <div className="card-header">
          <h2 className="card-title">International Space Station Speed Trend (Last 30)</h2>
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
              <YAxis domain={['dataMin - 50', 'dataMax + 50']} hide />
              <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px' }} />
              <Area type="monotone" dataKey="speed" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSpeed)" strokeWidth={3} isAnimationActive={true}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </aside>

      <div className="bottom-section">
        <section className="card news-card">
          <div className="card-header">
            <h2 className="card-title">Latest Headlines</h2>
            <button className="btn" onClick={() => fetchNews(activeCategory, true)}>Refresh</button>
          </div>
          <div className="news-tabs">
            {NEWS_CATEGORIES.map(cat => (
              <button key={cat} className={`news-tab ${activeCategory === cat ? 'active' : ''}`} onClick={() => setActiveCategory(cat)}>{cat}</button>
            ))}
          </div>
          <div className="news-controls">
            <input type="text" placeholder="Search..." className="search-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}/>
            <select className="btn" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="publishedAt">Date</option>
              <option value="source">Source</option>
            </select>
          </div>
          <div className="news-list">
            {newsLoading ? [...Array(6)].map((_, i) => <div key={i} className="skeleton-card skeleton"></div>) : 
             filteredArticles.map((article, i) => (
              <article key={i} className="news-item">
                <div className="news-img-container"><img src={article.image || 'https://via.placeholder.com/500'} className="news-img" /></div>
                <div className="news-content">
                  <div className="news-meta"><span>{article.source?.name}</span><span>{new Date(article.publishedAt).toLocaleDateString()}</span></div>
                  <h3>{article.title}</h3>
                  <p>{article.description}</p>
                  <div className="news-footer"><small>By {article.author || 'Unknown'}</small><a href={article.url} target="_blank" className="btn">Read</a></div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="side-charts">
          <section className="card distribution-card">
            <div className="card-header"><h2 className="card-title">Distribution</h2></div>
            <div className="doughnut-container" style={{height: '200px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={doughnutData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" onClick={(data) => setActiveCategory(data.catId)} style={{cursor: 'pointer'}}>
                    {doughnutData.map((entry, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="legend">
              {doughnutData.map((entry, index) => (
                <div key={index} className="legend-item" style={{display:'flex', gap:'8px', fontSize:'0.7rem', marginBottom:'4px'}}>
                  <div style={{width:'8px', height:'8px', background:COLORS[index % COLORS.length]}}></div>
                  <span>{entry.name}: {entry.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card astronauts-card">
            <div className="card-header"><h2 className="card-title">Astronauts</h2><div className="badge">{astros.number} Total</div></div>
            <div className="astro-grid">
              {astros.people.map((p, i) => (
                <div key={i} className="astro-item">
                  <div className="astro-avatar">{p.name.charAt(0)}</div>
                  <div className="astro-info"><div style={{fontWeight:'700'}}>{p.name}</div><div style={{fontSize:'0.7rem'}}>{p.craft}</div></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <button className="chat-toggle" onClick={() => setIsChatOpen(!isChatOpen)}>{isChatOpen ? '✖' : '💬'}</button>
      {isChatOpen && (
        <div className="chat-window">
          <div className="chat-header"><span>AI Mission Control</span><button className="btn-clear" onClick={clearChat}>🗑️</button></div>
          <div className="chat-messages">
            {messages.map((msg, i) => (<div key={i} className={`chat-bubble ${msg.role}`}><div className="bubble-text">{msg.text}</div><div className="bubble-time">{msg.timestamp}</div></div>))}
            {isTyping && <div className="chat-bubble bot typing"><div className="typing-dots"><span></span><span></span><span></span></div></div>}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-input-area" onSubmit={handleSendMessage}>
            <input type="text" placeholder="Ask AI..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
            <button type="submit" disabled={isTyping}>Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;



