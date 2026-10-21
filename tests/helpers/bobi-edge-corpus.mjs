// Human-labelled ambiguity and sub-day cases. Do not infer labels from parser output.
export function edgeCorpus() {
  return ['bg', 'en'].flatMap(lang => {
    const bg = lang === 'bg', name = bg ? 'Баня' : 'Springfield'
    const place = { name: bg ? 'Гела' : 'Lake District', latitude: bg ? 41.65 : 54.5, longitude: bg ? 24.5667 : -3.1667 }
    return [
      { category: 'same_name', message: bg ? 'Ще вали ли утре в Баня?' : 'Will it rain tomorrow in Springfield?',
        semantic: { intent: 'rain', requestedCity: name, citySource: 'explicit', timeSource: 'explicit', timeScope: 'tomorrow' },
        geo: [{ name, latitude: 42.5, longitude: 24.5, population: 1000, admin1: 'A' }, { name, latitude: 43.5, longitude: 25.5, population: 1000, admin1: 'B' }],
        expected: { intent: 'rain', needsClarification: true, missing: 'location', timeScope: 'tomorrow', targetDate: null }, aiCalls: 1 },
      { category: 'two_destinations', message: bg ? 'Ще вали ли утре в Гела или София?' : 'Will it rain tomorrow in Lake District or Sofia?',
        semantic: { intent: 'rain', needsClarification: true, missing: 'location', timeScope: 'tomorrow', timeSource: 'explicit' },
        geo: [place], expected: { intent: 'rain', needsClarification: true, missing: 'location', timeScope: 'tomorrow', targetDate: null }, aiCalls: 1 },
      { category: 'conflicting_periods', message: bg ? 'Ще вали ли утре вчера в Гела?' : 'Will it rain tomorrow yesterday in Lake District?',
        semantic: { intent: 'rain', requestedCity: place.name, citySource: 'explicit', needsClarification: true, missing: 'date', timeScope: 'general', timeSource: 'explicit' },
        geo: [place], expected: { intent: 'rain', needsClarification: true, missing: 'date', timeScope: 'general', targetDate: null }, aiCalls: 1 },
      { category: 'subday', message: bg ? 'Ще вали ли утре сутрин в Гела?' : 'Will it rain tomorrow morning in Lake District?',
        semantic: { intent: 'rain', requestedCity: place.name, citySource: 'explicit', timeScope: 'tomorrow_morning', timeSource: 'explicit' },
        geo: [place], expected: { intent: 'rain', needsClarification: false, timeScope: 'tomorrow_morning', targetDate: '2026-10-09', place }, aiCalls: 1 }
    ].map(item => ({ ...item, lang }))
  })
}
