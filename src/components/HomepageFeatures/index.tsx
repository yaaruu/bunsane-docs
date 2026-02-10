import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Focus on Business Logic',
    Svg: require('@site/static/img/undraw_deep-work_muov.svg').default,
    description: (
      <>
        Bunsane provides a batteries-included backend framework so you can focus
        on your business logic and ship faster.
      </>
    ),
  },
  {
    title: 'GraphQL Generator & Rest API',
    Svg: require('@site/static/img/undraw_building-blocks.svg').default,
    description: (
      <>
        Bunsane includes a powerful GraphQL generator and REST API support, making it easy to build and scale your backend services.
      </>
    ),
  },
  {
    title: 'Powered by Bun',
    Svg: require('@site/static/img/bun.svg').default,
    description: (
      <>
        Built on top of Bun, Bunsane leverages its high performance and modern features to deliver an exceptional developer experience.
      </>
    ),
  },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
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
