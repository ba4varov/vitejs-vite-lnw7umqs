import { PROJECTS } from './project-data.js'

type ProjectShowcaseProps = {
  lang: string
}

const ProjectIllustration = ({ project }: { project: string }) => (
  <svg className="project-illustration" viewBox="0 0 120 88" role="img" aria-label={project === 'iskra' ? 'Свързани сърца' : 'Картички с обяви'}>
    {project === 'iskra' ? (
      <>
        <circle cx="34" cy="29" r="18" />
        <circle cx="84" cy="55" r="22" />
        <path d="M40 54c8-12 32-15 39-3" />
        <path className="project-illustration-accent" d="M57 29c-8-10-23 2 0 18 23-16 8-28 0-18Z" />
        <path d="m91 20 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />
      </>
    ) : (
      <>
        <rect x="15" y="14" width="72" height="54" rx="12" />
        <rect x="35" y="28" width="70" height="48" rx="12" />
        <circle className="project-illustration-accent" cx="52" cy="44" r="7" />
        <path d="M66 40h25M66 49h18M47 61h44" />
        <path className="project-illustration-accent" d="m91 12 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />
      </>
    )}
  </svg>
)

export function ProjectShowcase({ lang }: ProjectShowcaseProps) {
  const locale = lang === 'en' ? 'en' : 'bg'
  const heading = locale === 'bg' ? 'Нашите проекти' : 'Our projects'
  const eyebrow = locale === 'bg' ? 'Още от нашия екип' : 'More from our team'
  const intro = locale === 'bg'
    ? 'Полезни дигитални пространства, създадени с внимание към хората.'
    : 'Useful digital spaces, thoughtfully created for people.'

  return (
    <section className="projects-section card" aria-labelledby="projects-title">
      <div className="projects-heading">
        <div>
          <p className="projects-eyebrow">{eyebrow}</p>
          <h2 id="projects-title">{heading}</h2>
        </div>
        <p>{intro}</p>
      </div>
      <div className="projects-grid">
        {PROJECTS.map(project => (
          <article className={`project-card project-${project.id}`} key={project.id}>
            <div className="project-copy">
              <span className="project-name">{project.name}</span>
              <p>{project.description[locale]}</p>
              <a href={project.url} target="_blank" rel="noopener noreferrer">
                {project.cta[locale]}
                <span aria-hidden="true">↗</span>
              </a>
            </div>
            <ProjectIllustration project={project.id} />
          </article>
        ))}
      </div>
    </section>
  )
}
