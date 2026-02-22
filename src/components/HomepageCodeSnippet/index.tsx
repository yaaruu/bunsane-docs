import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import styles from './styles.module.css';

const codeExample = `import { BaseComponent, CompData, Component } from "bunsane/core/components";
import { ArcheType, ArcheTypeField, BaseArcheType } from "bunsane/core/ArcheType";
import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Entity } from "bunsane/core/Entity";
import { t } from "bunsane/gql/schema";

// 1. Define Components
@Component
export class NameComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";
}

@Component
export class EmailComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";

  @CompData()
  verified: boolean = false;
}

// 2. Define an Archetype
@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(NameComponent)
  name!: NameComponent;

  @ArcheTypeField(EmailComponent)
  email!: EmailComponent;
}
export const UserArcheType = new UserArcheTypeClass();

// 3. Create a Service with GraphQL
class UserService extends BaseService {
  constructor() {
    super();
    UserArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { name: t.string().required(), email: t.string().email().required() },
    output: UserArcheType,
  })
  async createUser(args: { name: string; email: string }) {
    const user = Entity.Create()
      .add(NameComponent, { value: args.name })
      .add(EmailComponent, { value: args.email });
    await user.save();
    return user;
  }
}`;

export default function HomepageCodeSnippet(): ReactNode {
  return (
    <section className={styles.codeSection}>
      <div className="container">
        <div className={clsx('row', styles.codeRow)}>
          <div className={clsx('col col--5', styles.textCol)}>
            <Heading as="h2" className={styles.title}>
              Simple, Declarative, Powerful
            </Heading>
            <p className={styles.description}>
              BunSane uses the Entity-Component-System (ECS) architecture to keep your backend modular and scalable.
            </p>
            <ul className={styles.featureList}>
              <li>✅ Define atomic data with <code>@Component</code> & <code>@CompData</code></li>
              <li>✅ Structure entities with <code>@ArcheType</code></li>
              <li>✅ Expose GraphQL via <code>@GraphQLOperation</code></li>
              <li>✅ Automatic PostgreSQL tables & GraphQL schema</li>
            </ul>
          </div>
          <div className={clsx('col col--7', styles.codeCol)}>
            <div className={styles.codeWrapper}>
              <CodeBlock language="typescript" title="src/user.ts">
                {codeExample}
              </CodeBlock>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
