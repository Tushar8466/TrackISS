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

const ISS_API = 'https://api.open-notify.org/iss-now.json';
const ASTROS_API = 'https://api.open-notify.org/astros.json';
const NEWS_API = 'https://api.spaceflightnewsapi.net/v4/articles/?limit=5';
const GEOCODE_API = (lat, lng) => `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;

// Haversine formula to calculate distance between two points in km
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

function App() {
  const [positions, setPositions] = useState([]);
  const [astros, setAstros] = useState({ people: [], number: 0 });
  const [news, setNews] = useState([]);
  const [currentLocation, setCurrentLocation] = useState('Tracking...');
  const [speedData, setSpeedData] = useState([]);
  const [isDark, setIsDark] = useState(false);
  const [loading, setLoading] = useState(true);

  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const polylineRef = useRef(null);
  const mapContainerRef = useRef(null);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Map initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapRef.current = L.map(mapContainerRef.current, {
      center: [0, 0],
      zoom: 2,
      zoomControl: true
    });

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
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

    fetchInitialData();
    const interval = setInterval(fetchISS, 15000);

    return () => {
      clearInterval(interval);
      if (mapRef.current) mapRef.current.remove();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const [astrosRes, newsRes] = await Promise.all([
        fetch(ASTROS_API),
        fetch(NEWS_API)
      ]);
      const astrosData = await astrosRes.json();
      const newsData = await newsRes.json();
      setAstros(astrosData);
      setNews(newsData.results);
      await fetchISS();
    } catch (err) {
      console.error('Data fetch error', err);
    }
    setLoading(false);
  };

  const fetchISS = async () => {
    try {
      const res = await fetch(ISS_API);
      const data = await res.json();
      const { latitude, longitude } = data.iss_position;
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const timestamp = data.timestamp;

      updateState(lat, lng, timestamp);
    } catch (err) {
      console.error('ISS fetch error', err);
    }
  };

  const updateState = async (lat, lng, timestamp) => {
    const timeStr = new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setPositions(prev => {
      const newPos = [...prev, { lat, lng, timestamp, timeStr }].slice(-50);
      
      if (newPos.length >= 2) {
        const p1 = newPos[newPos.length - 2];
        const p2 = newPos[newPos.length - 1];
        const dist = calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        const timeH = (p2.timestamp - p1.timestamp) / 3600;
        const currentSpeed = timeH > 0 ? Math.round(dist / timeH) : 27600; // Average ISS speed fallback

        setSpeedData(prevSpeed => [...prevSpeed, { time: timeStr, speed: currentSpeed }].slice(-20));
      } else {
        setSpeedData([{ time: timeStr, speed: 27600 }]);
      }

      if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
      if (polylineRef.current) polylineRef.current.setLatLngs(newPos.map(p => [p.lat, p.lng]));
      
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
              <Area 
                type="monotone" 
                dataKey="speed" 
                stroke="#3b82f6" 
                fillOpacity={1} 
                fill="url(#colorSpeed)" 
                strokeWidth={3}
                animationDuration={1000}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </aside>

      <div className="bottom-section">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Breaking Space News</h2>
            <button className="btn">Refresh</button>
          </div>
          <div className="news-list">
            {news.map(article => (
              <div key={article.id} className="news-item">
                <img src={article.image_url} alt={article.title} className="news-img" />
                <div className="news-content">
                  <h3>{article.title}</h3>
                  <p>{article.summary.substring(0, 150)}...</p>
                  <small style={{color: 'var(--accent)', marginTop:'8px', display:'block'}}>
                    {article.news_site} • {new Date(article.published_at).toLocaleDateString()}
                  </small>
                </div>
              </div>
            ))}
          </div>
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
