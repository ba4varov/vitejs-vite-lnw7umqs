import { useState, useEffect, useRef } from 'react'
import './App.css'

const translations = {
  bg: {
    title: '🌤️ Доброто време с Боби',
    subtitle: 'Твоят метео гид',
    search: 'Търси град по целия свят...',
    info: '📡 Реални данни от Open-Meteo · Обновява се на всеки 15 мин',
    loading: '⏳ Зареждане...',
    tryAgain: 'Опитай отново',
    favorite: 'Любим град',
    humidity: 'Влажност',
    wind: 'Вятър',
    windUnit: 'км/ч',
    updated: 'Обновено',
    feelsLike: 'Усеща се като',
    visibility: 'Видимост',
    pressure: 'Налягане',
    uvIndex: 'UV индекс',
    seaTemp: 'Темп. на водата',
    sunrise: 'Изгрев',
    sunset: 'Залез',
    noSeaData: 'няма данни',
    km: 'км',
    hpa: 'hPa',
    hours24: '⏰ Следващите 24 часа',
    days14: '📅 Прогноза за 14 дни',
    myLocation: 'Моето местоположение',
    error: 'Неуспешно зареждане. Моля, опитайте отново.',
    chart: '📊 Графики за 24 часа',
    temp: 'Температура',
    rain: 'Валежи',
    windChart: 'Вятър',
    pressureChart: 'Налягане',
    mm: 'мм',
    cloudCover: 'Облачност',
    dewPoint: 'Точ. оросяване',
    detailsFor: 'Подробности за',
    tabMain: 'Основни',
    tabAtmosphere: 'Атмосфера',
    tabWaterWind: 'Вода и Вятър',
    weekDays: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    months: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
    highTemp: 'Опасно високи температури! (Над 35°C)',
    lowTemp: 'Опасно ниски температури! Опасност от измръзване.',
    highWind: 'Предупреждение за силен ураганен вятър!',
    highUv: 'Екстремен UV индекс! Пазете се от слънцето.',
    storm: 'Опасност: Приближава гръмотевична буря!',
    heavySnow: 'Предупреждение за обилен снеговалеж!',
    heavyRain: 'Опасност от проливни дъждове и наводнения!',
    weather: {
      0: 'Ясно небе', 1: 'Предимно ясно', 2: 'Частично облачно', 3: 'Облачно',
      45: 'Мъгла', 48: 'Замръзваща мъгла', 51: 'Лек ръмеж', 53: 'Умерен ръмеж',
      55: 'Силен ръмеж', 61: 'Слаб дъжд', 63: 'Умерен дъжд', 65: 'Силен дъжд',
      71: 'Слаб снеговалеж', 73: 'Умерен снеговалеж', 75: 'Силен снеговалеж',
      80: 'Превалявания', 81: 'Умерени превалявания', 82: 'Силни превалявания',
      95: 'Гръмотевична буря', 96: 'Буря с градушка', 99: 'Силна буря'
    },
    quickCities: [
      { name: 'Варна', lat: 43.2141, lon: 27.9147 },
      { name: 'София', lat: 42.6977, lon: 23.3219 },
      { name: 'Пловдив', lat: 42.1522, lon: 24.7454 },
      { name: 'Бургас', lat: 42.5048, lon: 27.4732 },
    ]
  },
  en: {
    title: '🌤️ Great Weather with Bobby',
    subtitle: 'Your meteo guide',
    search: 'Search any city in the world...',
    info: '📡 Live data from Open-Meteo · Auto-refresh every 15 min',
    loading: '⏳ Loading...',
    tryAgain: 'Try Again',
    favorite: 'Favorite City',
    humidity: 'Humidity',
    wind: 'Wind',
    windUnit: 'km/h',
    updated: 'Updated',
    feelsLike: 'Feels Like',
    visibility: 'Visibility',
    pressure: 'Pressure',
    uvIndex: 'UV Index',
    seaTemp: 'Water Temp',
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    noSeaData: 'n/a',
    km: 'km',
    hpa: 'hPa',
    hours24: '⏰ Next 24 Hours',
    days14: '📅 14-Day Forecast',
    myLocation: 'My Location',
    error: 'Failed to load weather data. Please try again.',
    chart: '📊 24-Hour Charts',
    temp: 'Temperature',
    rain: 'Precipitation',
    windChart: 'Wind',
    pressureChart: 'Pressure',
    mm: 'mm',
    cloudCover: 'Cloud Cover',
    dewPoint: 'Dew Point',
    detailsFor: 'Details for',
    tabMain: 'Main',
    tabAtmosphere: 'Atmosphere',
    tabWaterWind: 'Water & Wind',
    weekDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    highTemp: 'Extreme high temperatures! (Above 35°C)',
    lowTemp: 'Extreme low temperatures! Frost warning.',
    highWind: 'Severe gale/hurricane wind warning!',
    highUv: 'Extreme UV index! Avoid sun exposure.',
    storm: 'Danger: Thunderstorm approaching!',
    heavySnow: 'Heavy snowfall warning!',
    heavyRain: 'Heavy rainfall and flooding risk!',
    weather: {
      0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
      55: 'Heavy drizzle', 61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain',
      71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow',
      80: 'Rain showers', 81: 'Moderate showers', 82: 'Violent showers',
      95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Heavy thunderstorm'
    },
    quickCities: [
      { name: 'Varna', lat: 43.2141, lon: 27.9147 },
      { name: 'Sofia', lat: 42.6977, lon: 23.3219 },
      { name: 'Plovdiv', lat: 42.1522, lon: 24.7454 },
      { name: 'Burgas', lat: 42.5048, lon: 27.4732 },
    ]
  }
}

// Помощни компоненти (икони, графики и т.н. остават същите, тук ги съкратих за яснота)
const getIconAnimation = (icon: string) => { /* ... същата логика ... */ return 'float' }
const AnimatedIcon = ({ icon, size }: { icon: string, size?: string }) => (
  <span className={'animated-icon ' + getIconAnimation(icon)} style={{ fontSize: size || '1.5rem', display: 'inline-block' }}>{icon}</span>
)

// ... тук би трябвало да е SingleChart и Chart компонентите отпреди ...

const WeatherApp = () => {
  // ... същия стейт и fetch логика ...
  // ... следният рендеринг за main-card:
  return (
    <div className={darkMode ? 'weather-app dark' : 'weather-app'}>
      {/* ... хедър и търсачка ... */}
      
      {!loading && !error && weather && (
        <div>
          {/* АЛАРМИ */}
          {activeAlerts.length > 0 && <div className="alerts-container">{/* ... */}</div>}

          {/* ГЛАВНА КАРТА С ПРАВИЛЕН СТИЛ */}
          <div className="card main-card" style={{ 
            backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 60%, transparent 100%), url('${bgImageUrl}')` 
          }}>
            {/* Съдържанието на картата... */}
          </div>

          {/* ХОРИЗОНТАЛЕН РЕД */}
          <div className="card">
            <h3>{t.hours24}</h3>
            <div className="hourly-row">
              {hourly.map((h, i) => (
                <div key={i} className="hour-box">
                  {/* ... съдържание ... */}
                </div>
              ))}
            </div>
          </div>
          {/* ... останалите графики ... */}
        </div>
      )}
    </div>
  )
}
export default WeatherApp
