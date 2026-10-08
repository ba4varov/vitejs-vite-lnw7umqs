const paths: Record<string, string[]> = {
  total: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 3a4 4 0 0 1 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 3a4 4 0 0 1 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87'],
  last7: ['M12 8v4l3 2'], last30: ['M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2'],
  favorites: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
  free: ['M12 3 3 8v8l9 5 9-5V8Z', 'm3 8 9 5 9-5M12 13v8'],
  pro: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
  dashboard: ['M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z'],
  analytics: ['M4 3v18h17M8 16v-5M13 16V7M18 16v-8'],
  audit: ['M8 3h12v18H4V7', 'M8 3v4H4l4-4M8 11h8M8 15h8'],
  system: ['M2 12h4l3-8 6 16 3-8h4'],
  profile: ['M5 21a7 7 0 0 1 14 0'],
}
export function AdminIcon({ name }: { name: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{(paths[name] || paths.dashboard).map((d,i)=><path key={i} d={d}/>)}{['total','users','profile'].includes(name) && <circle cx={name==='profile'?12:9} cy="7" r="4"/>}{name==='last7' && <circle cx="12" cy="12" r="9"/>}</svg>
}
