* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  margin: 0;
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.weather-app {
  min-height: 100vh;
  padding: 24px;
  background: #eef6ff;
  color: #1e293b;
  transition: background 0.3s, color 0.3s;
}

.weather-app.dark {
  background: #0f172a;
  color: #f8fafc;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 800px;
  margin: 0 auto 32px;
}

.header-title-wrapper h1 {
  font-size: 2rem;
  margin: 0;
}

.header-btns {
  display: flex;
  gap: 12px;
}

.lang-btn, .icon-btn {
  background: rgba(0,0,0,0.05);
  color: inherit;
  border: none;
  padding: 8px 16px;
  border-radius: 20px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.weather-app.dark .lang-btn,
.weather-app.dark .icon-btn {
  background: rgba(255,255,255,0.1);
}

.lang-btn:hover, .icon-btn:hover {
  transform: scale(1.05);
}

.search-wrapper {
  max-width: 800px;
  margin: 0 auto 16px;
  position: relative;
}

.search-row input {
  width: 100%;
  padding: 16px 24px;
  border-radius: 24px;
  border: 1px solid rgba(0,0,0,0.1);
  background: rgba(255,255,255,0.7);
  font-size: 1.1rem;
  outline: none;
  color: #1e293b;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
}

.weather-app.dark .search-row input {
  background: rgba(30,41,55,0.8);
  border: 1px solid rgba(255,255,255,0.1);
  color: white;
}

.suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border-radius: 16px;
  margin-top: 8px;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0,0,0,0.1);
  z-index: 100;
}

.weather-app.dark .suggestions {
  background: #1e293b;
}

.suggestion-item {
  padding: 12px 24px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}

.suggestion-item:hover {
  background: rgba(0,0,0,0.03);
}

.weather-app.dark .suggestion-item {
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.weather-app.dark .suggestion-item:hover {
  background: rgba(255,255,255,0.05);
}

.sug-country {
  opacity: 0.6;
  font-size: 0.9rem;
}

.info-line {
  text-align: center;
  opacity: 0.7;
  font-size: 0.85rem;
  margin-bottom: 24px;
}

.city-row {
  max-width: 800px;
  margin: 0 auto 32px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.city-btn {
  padding: 8px 16px;
  border-radius: 20px;
  border: none;
  background: rgba(0,0,0,0.05);
  color: inherit;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s;
}

.weather-app.dark .city-btn {
  background: rgba(255,255,255,0.1);
}

.city-btn.active {
  background: #2563eb;
  color: white;
  font-weight: bold;
}

.card {
  max-width: 800px;
  margin: 0 auto 24px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
}

.weather-app.dark .card {
  background: rgba(30,41,55,0.5);
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
}

.main-card {
  color: #1e293b;
  border: 1px solid rgba(255,255,255,0.2);
}

.weather-app.dark .main-card {
  color: white;
}

.main-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.main-top h2 {
  font-size: 1.8rem;
  margin-bottom: 8px;
}

.main-top .desc {
  font-size: 1.2rem;
  opacity: 0.9;
  text-transform: capitalize;
}

.big-temp {
  font-size: 5rem;
  font-weight: 800;
  margin-bottom: 32px;
  line-height: 1;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 16px;
}

.stat-box {
  background: rgba(0,0,0,0.03);
  padding: 16px;
  border-radius: 16px;
  text-align: center;
}

.weather-app.dark .stat-box {
  background: rgba(255,255,255,0.1);
}

.stat-box p { margin: 0; }
.stat-box .label { font-size: 0.85rem; opacity: 0.8; margin: 8px 0 4px; }
.stat-box .value { font-weight: bold; font-size: 1.1rem; }

.sea-temp-box {
  background: rgba(14, 165, 233, 0.1);
}

.weather-app.dark .sea-temp-box {
  background: rgba(56, 189, 248, 0.2);
}

h3 {
  margin-top: 0;
  margin-bottom: 20px;
  font-size: 1.3rem;
  opacity: 0.9;
}

.hourly-row {
  display: flex;
  overflow-x: auto;
  gap: 12px;
  padding-bottom: 16px;
}

.hourly-row::-webkit-scrollbar { height: 6px; }
.hourly-row::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 10px; }
.weather-app.dark .hourly-row::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); }

.hour-box {
  background: rgba(0,0,0,0.03);
  min-width: 80px;
  padding: 16px 8px;
  border-radius: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.weather-app.dark .hour-box { background: rgba(255,255,255,0.05); }

.hour-time { font-weight: bold; font-size: 0.9rem; }
.hour-temp { font-size: 1.2rem; font-weight: bold; }
.hour-wind, .hour-sea { font-size: 0.75rem; opacity: 0.8; }

.chart-container { overflow-x: auto; }
.chart-tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
.chart-tab {
  padding: 6px 12px;
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,0.1);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}
.weather-app.dark .chart-tab { border-color: rgba(255,255,255,0.2); }

.chart-tab.active-temp { background: #f97316; color: white; border-color: #f97316; }
.chart-tab.active-rain { background: #3b82f6; color: white; border-color: #3b82f6; }
.chart-tab.active-wind { background: #10b981; color: white; border-color: #10b981; }
.chart-tab.active-pressure { background: #a855f7; color: white; border-color: #a855f7; }

.daily-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
}

.day-box {
  background: rgba(0,0,0,0.03);
  padding: 16px 8px;
  border-radius: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.weather-app.dark .day-box { background: rgba(255,255,255,0.05); }

.day-name { font-weight: bold; font-size: 1rem; }
.day-temp { font-size: 1.1rem; }
.day-temp .max { font-weight: bold; }
.day-temp .min { opacity: 0.7; font-size: 0.9rem; }
.day-rain, .day-wind { font-size: 0.75rem; opacity: 0.8; }

.center-text { text-align: center; }
.search-btn {
  background: #2563eb;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 20px;
  font-size: 1rem;
  cursor: pointer;
  font-weight: bold;
}

/* Animations */
@keyframes spin-slow { 100% { transform: rotate(360deg); } }
.spin-slow { animation: spin-slow 12s linear infinite; }

@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.float { animation: float 3s ease-in-out infinite; }

@keyframes bounce-rain { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.bounce-rain { animation: bounce-rain 1.5s ease-in-out infinite; }

@keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.flash { animation: flash 2s ease-in-out infinite; }

@keyframes fall { 0% { transform: translateY(-2px); } 100% { transform: translateY(2px); } }
.fall { animation: fall 2s linear infinite alternate; }

@keyframes drift { 0% { transform: translateX(-2px); } 100% { transform: translateX(2px); } }
.drift { animation: drift 3s ease-in-out infinite alternate; }

@media (max-width: 600px) {
  .header-row { flex-direction: column; gap: 16px; align-items: stretch; text-align: center; }
  .header-btns { justify-content: center; }
  .big-temp { font-size: 4rem; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .daily-grid { grid-template-columns: repeat(3, 1fr); gap: 12px; }
}
