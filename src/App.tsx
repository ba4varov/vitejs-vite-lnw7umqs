import { useState, useEffect, useRef } from 'react';

// Речник с преводи
const translations = {
  bg: {
    searchPlaceholder: 'Търси град...',
    temp: 'Температура',
    wind: 'Вятър',
    humidity: 'Влажност',
    loading: 'Зареждане...',
    error: 'Грешка при зареждане',
    adviceTitle: 'Съвет от синоптика',
    getAdvice: 'Нов съвет'
  },
  en: {
    searchPlaceholder: 'Search city...',
    temp: 'Temperature',
    wind: 'Wind',
    humidity: 'Humidity',
    loading: 'Loading...',
    error: 'Error loading',
    adviceTitle: 'Forecaster Advice',
    getAdvice: 'New Advice'
  }
};

export default function WeatherApp() {
  const [lang, setLang] = useState('bg');
  const [city, setCity] = useState('Варна');
  const [weatherData, setWeatherData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('main');
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);

  const searchTimer = useRef<any>(null);
  const t = translations[lang as keyof typeof translations];

  // ТУК СЕ ВЗИМА СИГУРНИЯТ КЛЮЧ ОТ VERCEL
  const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

  const fetchWeather = async (cityName: string) => {
    setLoading(true);
    setError(null);
    try {
      // Тук е логиката ти за взимане на реалните данни за времето. 
      // За примера ползваме базов обект.
      const data = {
        city: cityName,
        temp: 28,
        wind: 15,
        humidity: 60,
        description: 'Слънчево'
      };
      setWeatherData(data);
      fetchAiAdvice(data);
    } catch (err) {
      setError(t.error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAiAdvice = async (dataForAi: any) => {
    // Проверка дали ключът е зареден успешно
    if (!API_KEY) {
      console.error("Ключът липсва! Провери настройките (Environment Variables) във Vercel.");
      setAiAdvice("Изчаквам връзка със синоптика...");
      return;
    }

    try {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + API_KEY;
      
      const prompt = `Ти си приятелски настроен и забавен метеоролог. Твоята задача е да анализираш тези метеорологични данни: Град: ${dataForAi.city}, Температура: ${dataForAi.temp} градуса, Вятър: ${dataForAi.wind} км/ч, Влажност: ${dataForAi.humidity}%. Генерирай точно едно кратко изречение с практичен и полезен съвет за деня. Тонът ти трябва да бъде свеж, земен и позитивен. Абсолютно задължително е да завършиш съвета с фразата: Всичко Е СМЯХ и ЛЮБОВ`;
      
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      
      const data = await response.json();
      
      if (data.error) {
        console.error("Грешка от Google API:", data.error.message);
        setAiAdvice("Синоптикът си взе почивка. Опитай пак по-късно!");
        return;
      }

      if (data.candidates && data.candidates.length > 0) {
        setAiAdvice(data.candidates[0].content.parts[0].text);
      }
    } catch (err) {
      console.error("Грешка при връзката с Gemini:", err);
      setAiAdvice("Няма връзка със синоптика.");
    }
  };

  useEffect(() => {
    fetchWeather(city);
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCity(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (val.trim()) fetchWeather(val);
    }, 800);
  };

  return (
    <div className="min-h-screen bg-blue-100 p-4 flex flex-col items-center justify-center font-sans">
      <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md">
        
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Метеоролог</h1>
          <button 
            onClick={() => setLang(lang === 'bg' ? 'en' : 'bg')}
            className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300 transition uppercase"
          >
            {lang}
          </button>
        </div>

        <input 
          type="text" 
          value={city}
          onChange={handleSearch}
          placeholder={t.searchPlaceholder}
          className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        {loading && <p className="text-gray-500 text-center">{t.loading}</p>}
        {error && <p className="text-red-500 text-center">{error}</p>}

        {!loading && !error && weatherData && (
          <div className="text-center">
            <h2 className="text-3xl font-semibold mb-2">{weatherData.city}</h2>
            <div className="text-5xl font-bold text-blue-600 mb-4">
              {weatherData.temp}°C
            </div>
            <div className="flex justify-center space-x-4 text-gray-600 mb-6">
              <span>{t.wind}: {weatherData.wind} km/h</span>
              <span>{t.humidity}: {weatherData.humidity}%</span>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
              <h3 className="font-bold text-blue-800 mb-2">{t.adviceTitle}</h3>
              <p className="text-gray-700 italic">
                {aiAdvice || "Генериране на съвет..."}
              </p>
              <button 
                onClick={() => fetchAiAdvice(weatherData)}
                className="mt-4 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition text-sm font-medium"
              >
                {t.getAdvice}
              </button>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}
