import { getIconAnimation } from '../utils/weatherPresentation'

interface AnimatedIconProps {
  icon: string
  size?: string
}

export const AnimatedIcon = ({ icon, size }: AnimatedIconProps) => {
  const sz = size || '1.5rem'
  return (
    <span className={'animated-icon ' + getIconAnimation(icon)} style={{ fontSize: sz, display: 'inline-block' }}>
      {icon}
    </span>
  )
}
