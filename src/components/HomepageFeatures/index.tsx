import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'ECS Architecture',
    icon: '🧩',
    description: (
      <>
        Built on the Entity-Component-System pattern, providing a highly decoupled,
        scalable, and maintainable architecture for complex backend applications.
      </>
    ),
  },
  {
    title: 'Powered by Bun',
    icon: '🥟',
    description: (
      <>
        Leverages Bun's incredible performance and modern TypeScript
        runtime to deliver blazing fast execution.
      </>
    ),
  },
  {
    title: 'GraphQL & REST',
    icon: '⚡',
    description: (
      <>
        Automatically generates GraphQL schemas and REST endpoints from your components
        and services, saving you hours of boilerplate.
      </>
    ),
  },
  {
    title: 'PostgreSQL Native',
    icon: '🐘',
    description: (
      <>
        First-class support for PostgreSQL with automatic table generation, migrations,
        and optimized queries out of the box.
      </>
    ),
  },
  {
    title: '100% Type-Safe',
    icon: '🛡️',
    description: (
      <>
        Written in TypeScript with strict typing. Catch errors at compile time and
        enjoy excellent IDE autocompletion.
      </>
    ),
  },
  {
    title: 'BunSane Studio',
    icon: '🔍',
    description: (
      <>
        Built-in development dashboard to browse entities, inspect components,
        and debug your PostgreSQL data without leaving your workflow.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4', styles.featureCol)}>
      <div className={styles.featureCard}>
        <div className={styles.featureIcon}>{icon}</div>
        <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
        <p className={styles.featureDesc}>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
