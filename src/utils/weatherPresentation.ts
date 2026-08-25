export const getDynamicOverlay = (temp: number) => {
  let rgbDark, rgbLight;
  if (temp <= 0) {
    rgbDark = '15, 23, 42'; 
    rgbLight = '56, 189, 248'; 
  } else if (temp <= 15) {
    rgbDark = '6, 78, 59'; 
    rgbLight = '52, 211, 153'; 
  } else if (temp <= 29) {
    rgbDark = '120, 53, 15'; 
    rgbLight = '251, 191, 36'; 
  } else {
    rgbDark = '127, 29, 29'; 
    rgbLight = '248, 113, 113'; 
  }
  return `linear-gradient(to right, rgba(${rgbDark}, 0.95) 0%, rgba(${rgbDark}, 0.6) 50%, rgba(${rgbLight}, 0.1) 100%)`;
}

export const getIconAnimation = (icon: string) => {
  if (icon === '☀️') return 'spin-slow'
  if (icon === '🌤️' || icon === '⛅') return 'float'
  if (icon === '🌧️' || icon === '🌦️') return 'bounce-rain'
  if (icon === '⛈️') return 'flash'
  if (icon === '❄️' || icon === '🌨️') return 'fall'
  if (icon === '🌫️') return 'drift'
  return 'float'
}
